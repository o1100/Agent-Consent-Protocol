import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createGate, type ConsentGate } from '../core/gate.js';
import { parsePolicy } from '../core/policy.js';
import { FileAuditLog } from '../core/audit.js';
import type { Action } from '../core/types.js';
import type { Channel, ChannelResponse } from '../core/channel.js';

class MockChannel implements Channel {
  public lastAction: Action | null = null;
  public response: ChannelResponse = { approved: true };
  public askCount = 0;

  async ask(action: Action, _timeoutMs: number): Promise<ChannelResponse> {
    this.askCount += 1;
    this.lastAction = action;
    return this.response;
  }
}

describe('ConsentGate', () => {
  let tmpDir: string;
  let gate: ConsentGate;
  let channel: MockChannel;
  let auditPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-gate-test-'));
    auditPath = path.join(tmpDir, 'audit.jsonl');
    channel = new MockChannel();

    const policy = parsePolicy(`
default: ask
wrap: []
rules:
  - match: { name: "cat" }
    action: allow
  - match: { name: "rm", args: "-rf /*" }
    action: deny
  - match: { name: "rm" }
    action: ask
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
  - match: { kind: http, host: "*.evil.com" }
    action: deny
`);

    gate = createGate({
      policy,
      channel,
      audit: new FileAuditLog(auditPath),
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-allows actions matching allow rules', async () => {
    const verdict = await gate({
      name: 'cat',
      args: '/workspace/file.txt',
      meta: { kind: 'shell' },
    });

    assert.strictEqual(verdict.decision, 'allow');
    assert.strictEqual(channel.lastAction, null); // No channel call
  });

  it('auto-denies actions matching deny rules', async () => {
    const verdict = await gate({
      name: 'rm',
      args: '-rf /*',
      meta: { kind: 'shell' },
    });

    assert.strictEqual(verdict.decision, 'deny');
    assert.strictEqual(channel.lastAction, null);
  });

  it('asks human for actions matching ask rules', async () => {
    channel.response = { approved: true };

    const verdict = await gate({
      name: 'rm',
      args: 'important.txt',
      meta: { kind: 'shell' },
    });

    assert.strictEqual(verdict.decision, 'allow');
    assert.strictEqual(verdict.reason, 'Approved by human');
    assert.ok(channel.lastAction);
    assert.strictEqual(channel.lastAction.name, 'rm');
  });

  it('denies when human denies', async () => {
    channel.response = { approved: false, reason: 'Too risky' };

    const verdict = await gate({
      name: 'rm',
      args: 'important.txt',
      meta: { kind: 'shell' },
    });

    assert.strictEqual(verdict.decision, 'deny');
    assert.strictEqual(verdict.reason, 'Too risky');
  });

  it('allows safe HTTP destinations', async () => {
    const verdict = await gate({
      name: 'http:GET',
      args: 'https://api.anthropic.com/v1/messages',
      meta: { kind: 'http', host: 'api.anthropic.com', method: 'GET' },
    });

    assert.strictEqual(verdict.decision, 'allow');
  });

  it('denies evil HTTP destinations', async () => {
    const verdict = await gate({
      name: 'http:CONNECT',
      args: 'www.evil.com:443',
      meta: { kind: 'http', host: 'www.evil.com', method: 'CONNECT' },
    });

    assert.strictEqual(verdict.decision, 'deny');
  });

  it('asks for unmatched actions (default: ask)', async () => {
    channel.response = { approved: false, reason: 'Nope' };

    const verdict = await gate({
      name: 'wget',
      args: 'https://unknown.com/file',
      meta: { kind: 'shell' },
    });

    assert.strictEqual(verdict.decision, 'deny');
    assert.ok(channel.lastAction);
  });

  it('writes audit entries for every decision', async () => {
    await gate({ name: 'cat', meta: { kind: 'shell' } });
    await gate({ name: 'rm', args: '-rf /*', meta: { kind: 'shell' } });

    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n');
    assert.strictEqual(lines.length, 2);

    const entry1 = JSON.parse(lines[0]);
    assert.strictEqual(entry1.action.name, 'cat');
    assert.strictEqual(entry1.verdict.decision, 'allow');

    const entry2 = JSON.parse(lines[1]);
    assert.strictEqual(entry2.action.name, 'rm');
    assert.strictEqual(entry2.verdict.decision, 'deny');
  });

  it('reuses recent HTTP approvals for www/non-www host twins', async () => {
    channel.response = { approved: true };

    const firstVerdict = await gate({
      name: 'http:CONNECT',
      args: 'google.com:443',
      meta: { kind: 'http', host: 'google.com', method: 'CONNECT' },
    });

    assert.strictEqual(firstVerdict.decision, 'allow');
    assert.strictEqual(channel.askCount, 1);

    channel.response = { approved: false, reason: 'should not be used' };
    const secondVerdict = await gate({
      name: 'http:CONNECT',
      args: 'www.google.com:443',
      meta: { kind: 'http', host: 'www.google.com', method: 'CONNECT' },
    });

    assert.strictEqual(secondVerdict.decision, 'allow');
    assert.strictEqual(secondVerdict.reason, 'Approved by human (cached host approval)');
    assert.strictEqual(channel.askCount, 1);
  });
});
