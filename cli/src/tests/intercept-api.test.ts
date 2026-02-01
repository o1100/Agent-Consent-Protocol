import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpProxy } from '../proxy/mcp-proxy.js';
import { ConsentGate, type ChannelAdapter, type ConsentDecision, type ConsentDisplayRequest } from '../proxy/consent-gate.js';
import { PolicyEngine, type Policy } from '../policy/engine.js';
import { CredentialVault } from '../sandbox/credentials.js';
import { AuditLogger } from '../audit/logger.js';
import { generateKeyPair } from '../crypto/keys.js';

class MockChannel implements ChannelAdapter {
  name = 'mock';
  public decision: ConsentDecision = { approved: true };
  async requestConsent(_request: ConsentDisplayRequest): Promise<ConsentDecision> {
    return this.decision;
  }
}

function httpRequest(options: http.RequestOptions, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('/acp/intercept endpoint', () => {
  let tmpDir: string;
  let proxy: McpProxy;
  const port = 18443;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-intercept-test-'));
    const vaultPath = path.join(tmpDir, 'vault.json');
    const auditPath = path.join(tmpDir, 'audit.jsonl');
    const keyDir = path.join(tmpDir, '.acp', 'keys');
    fs.mkdirSync(keyDir, { recursive: true });

    const kp = generateKeyPair();
    fs.writeFileSync(path.join(keyDir, 'private.key'), kp.privateKey);

    const policy: Policy = {
      version: '2',
      default_action: 'ask',
      rules: [
        { match: { kind: 'shell', tool: 'shell:git', command: 'git status*' }, action: 'allow' },
        { match: { kind: 'http', host: '*.googleapis.com' }, action: 'allow' },
        { match: { category: 'read' }, action: 'allow' },
        { match: { tool: 'shell:rm' }, action: 'deny' },
      ],
    };

    const channel = new MockChannel();
    const vault = new CredentialVault(vaultPath);
    const auditLogger = new AuditLogger(auditPath);

    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;

    const consentGate = new ConsentGate({
      policyEngine: new PolicyEngine(policy),
      channel,
      vault,
      auditLogger,
      config: {},
    });

    process.env.HOME = origHome;

    proxy = new McpProxy({
      port,
      consentGate,
      auditLogger,
      upstreamServers: [],
    });

    await proxy.start();
  });

  after(async () => {
    await proxy.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns health check', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/acp/health',
      method: 'GET',
    });
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.version, '0.3.0');
  });

  it('allows shell command matching allow rule', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/acp/intercept',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, JSON.stringify({
      kind: 'shell',
      tool: 'shell:git',
      arguments: { command: 'git status' },
    }));

    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.allowed, true);
  });

  it('denies shell command matching deny rule', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/acp/intercept',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, JSON.stringify({
      kind: 'shell',
      tool: 'shell:rm',
      arguments: { command: 'rm -rf /' },
    }));

    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.allowed, false);
  });

  it('allows HTTP request matching host rule', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/acp/intercept',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, JSON.stringify({
      kind: 'http',
      tool: 'http:GET',
      arguments: { host: 'api.googleapis.com', method: 'GET', url: 'https://api.googleapis.com/v1/test' },
    }));

    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.allowed, true);
  });

  it('rejects requests with missing fields', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/acp/intercept',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, JSON.stringify({ kind: 'shell' }));

    assert.strictEqual(res.status, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.allowed, false);
    assert.ok(body.reason.includes('Missing required fields'));
  });

  it('returns 404 for unknown /acp/ routes', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/acp/unknown',
      method: 'GET',
    });
    assert.strictEqual(res.status, 404);
  });

  it('MCP JSON-RPC still works alongside /acp/ routes', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
    }));

    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.jsonrpc, '2.0');
    assert.deepStrictEqual(body.result, {});
  });
});
