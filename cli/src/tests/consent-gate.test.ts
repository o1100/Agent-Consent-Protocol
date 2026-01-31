import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConsentGate, type ChannelAdapter, type ConsentDecision, type ConsentDisplayRequest } from '../proxy/consent-gate.js';
import { PolicyEngine, type Policy } from '../policy/engine.js';
import { CredentialVault } from '../sandbox/credentials.js';
import { AuditLogger } from '../audit/logger.js';
import { generateKeyPair } from '../crypto/keys.js';

/** Mock channel that auto-approves or auto-denies */
class MockChannel implements ChannelAdapter {
  name = 'mock';
  public lastRequest: ConsentDisplayRequest | null = null;
  public decision: ConsentDecision = { approved: true };

  async requestConsent(request: ConsentDisplayRequest): Promise<ConsentDecision> {
    this.lastRequest = request;
    return this.decision;
  }
}

function setupTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-gate-test-'));
  const vaultPath = path.join(tmpDir, 'vault.json');
  const auditPath = path.join(tmpDir, 'audit.jsonl');
  const keyDir = path.join(tmpDir, 'keys');
  fs.mkdirSync(keyDir, { recursive: true });

  // Generate and write key
  const kp = generateKeyPair();
  const keyPath = path.join(keyDir, 'private.key');
  fs.writeFileSync(keyPath, kp.privateKey);

  // Also write public key for verification
  const pubKeyPath = path.join(keyDir, 'public.key');
  fs.writeFileSync(pubKeyPath, kp.publicKey);

  return { tmpDir, vaultPath, auditPath, keyPath, pubKeyPath, kp };
}

describe('ConsentGate', () => {
  let tmpDir: string;
  let channel: MockChannel;
  let gate: ConsentGate;
  let vault: CredentialVault;

  beforeEach(() => {
    const env = setupTestEnv();
    tmpDir = env.tmpDir;
    channel = new MockChannel();

    const policy: Policy = {
      version: '1',
      default_action: 'ask',
      rules: [
        { match: { category: 'read' }, action: 'allow' },
        { match: { tool: 'blocked_tool' }, action: 'deny' },
      ],
    };

    vault = new CredentialVault(env.vaultPath, env.keyPath);
    vault.set('SMTP_PASSWORD', 'secret123');

    // Temporarily override HOME for the ConsentGate to find keys
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    // Create ~/.acp/keys structure
    const acpKeyDir = path.join(tmpDir, '.acp', 'keys');
    fs.mkdirSync(acpKeyDir, { recursive: true });
    fs.copyFileSync(env.keyPath, path.join(acpKeyDir, 'private.key'));

    gate = new ConsentGate({
      policyEngine: new PolicyEngine(policy),
      channel,
      vault,
      auditLogger: new AuditLogger(env.auditPath),
      config: {},
    });

    process.env.HOME = origHome;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-allows read operations', async () => {
    const result = await gate.process({
      tool: 'web_search',
      arguments: { query: 'hello' },
      requestId: '1',
    });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.category, 'read');
    // No consent proof for auto-allow (no human involved)
    assert.strictEqual(result.consent_proof, undefined);
  });

  it('auto-denies blocked tools', async () => {
    const result = await gate.process({
      tool: 'blocked_tool',
      arguments: {},
      requestId: '2',
    });
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason, 'Expected a denial reason');
  });

  it('asks human for unmatched tools and returns consent proof on approval', async () => {
    channel.decision = { approved: true };

    const result = await gate.process({
      tool: 'some_tool',
      arguments: { param: 'value' },
      requestId: '3',
    });

    assert.strictEqual(result.allowed, true);
    assert.ok(channel.lastRequest);
    assert.strictEqual(channel.lastRequest.tool, 'some_tool');

    // Should have a consent proof
    assert.ok(result.consent_proof);
    assert.ok(result.consent_proof.consent_id);
    assert.ok(result.consent_proof.signature);
    assert.strictEqual(result.consent_proof.tool, 'some_tool');
    assert.strictEqual(result.consent_proof.decision, 'approved');
    assert.ok(result.consent_proof.nonce.startsWith('n_'));
    assert.ok(result.consent_proof.arguments_hash.startsWith('sha256:'));
  });

  it('returns consent proof on denial too', async () => {
    channel.decision = { approved: false, reason: 'Not now' };

    const result = await gate.process({
      tool: 'some_tool',
      arguments: {},
      requestId: '4',
    });

    assert.strictEqual(result.allowed, false);
    assert.ok(result.consent_proof);
    assert.strictEqual(result.consent_proof.decision, 'denied');
    assert.ok(result.consent_proof.signature);
  });

  it('injects vault credentials into approved args', async () => {
    const result = await gate.process({
      tool: 'web_search',
      arguments: { password: '$VAULT:SMTP_PASSWORD' },
      requestId: '5',
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.modifiedArgs?.password, 'secret123');
  });

  it('applies modifications from human decision', async () => {
    channel.decision = {
      approved: true,
      modifications: { extra_param: 'added' },
    };

    const result = await gate.process({
      tool: 'some_tool',
      arguments: { original: 'value' },
      requestId: '6',
    });

    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.modifiedArgs?.original, 'value');
    assert.strictEqual(result.modifiedArgs?.extra_param, 'added');
  });
});
