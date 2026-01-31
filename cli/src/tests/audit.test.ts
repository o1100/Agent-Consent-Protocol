import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AuditLogger } from '../audit/logger.js';

describe('AuditLogger', () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-audit-test-'));
    logPath = path.join(tmpDir, 'audit.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a log entry with required fields', () => {
    const logger = new AuditLogger(logPath);
    const event = logger.record({
      event_type: 'test_event',
      agent: 'test-agent',
      tool: 'test_tool',
      category: 'test',
      risk_level: 'low',
    });

    assert.ok(event.id.startsWith('ae_'));
    assert.ok(event.timestamp);
    assert.strictEqual(event.type, 'audit_event');
    assert.strictEqual(event.event_type, 'test_event');
    assert.strictEqual(event.tool, 'test_tool');
    assert.ok(event.event_hash.startsWith('sha256:'));
  });

  it('first event has null previous_event_hash', () => {
    const logger = new AuditLogger(logPath);
    const event = logger.record({
      event_type: 'first',
      agent: 'a',
      tool: 't',
      category: 'c',
      risk_level: 'low',
    });
    assert.strictEqual(event.previous_event_hash, null);
  });

  it('chains events via previous_event_hash', () => {
    const logger = new AuditLogger(logPath);
    const e1 = logger.record({
      event_type: 'e1',
      agent: 'a',
      tool: 't',
      category: 'c',
      risk_level: 'low',
    });
    const e2 = logger.record({
      event_type: 'e2',
      agent: 'a',
      tool: 't',
      category: 'c',
      risk_level: 'low',
    });
    assert.strictEqual(e2.previous_event_hash, e1.event_hash);
  });

  it('verifyChain returns valid for correct chain', () => {
    const logger = new AuditLogger(logPath);
    logger.record({ event_type: 'e1', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });
    logger.record({ event_type: 'e2', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });
    logger.record({ event_type: 'e3', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });

    const result = logger.verifyChain();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.eventCount, 3);
  });

  it('verifyChain detects tampering', () => {
    const logger = new AuditLogger(logPath);
    logger.record({ event_type: 'e1', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });
    logger.record({ event_type: 'e2', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });

    // Tamper with the log file
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const event = JSON.parse(lines[0]);
    event.tool = 'tampered_tool';
    lines[0] = JSON.stringify(event);
    fs.writeFileSync(logPath, lines.join('\n') + '\n');

    const freshLogger = new AuditLogger(logPath);
    const result = freshLogger.verifyChain();
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
  });

  it('verifyChain returns valid for empty log', () => {
    const logger = new AuditLogger(logPath);
    const result = logger.verifyChain();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.eventCount, 0);
  });

  it('restores chain state across instances', () => {
    const logger1 = new AuditLogger(logPath);
    const e1 = logger1.record({ event_type: 'e1', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });

    const logger2 = new AuditLogger(logPath);
    const e2 = logger2.record({ event_type: 'e2', agent: 'a', tool: 't', category: 'c', risk_level: 'low' });

    assert.strictEqual(e2.previous_event_hash, e1.event_hash);

    const result = logger2.verifyChain();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.eventCount, 2);
  });
});
