import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HttpProxy } from '../proxy/http-proxy.js';
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

function httpRequest(options: http.RequestOptions, body?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('HttpProxy', () => {
  let tmpDir: string;
  let httpProxy: HttpProxy;
  let targetServer: http.Server;
  const proxyPort = 19444;
  const targetPort = 19555;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-httpproxy-test-'));
    const vaultPath = path.join(tmpDir, 'vault.json');
    const auditPath = path.join(tmpDir, 'audit.jsonl');
    const keyDir = path.join(tmpDir, '.acp', 'keys');
    fs.mkdirSync(keyDir, { recursive: true });

    const kp = generateKeyPair();
    fs.writeFileSync(path.join(keyDir, 'private.key'), kp.privateKey);

    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { kind: 'http', host: '127.0.0.1' }, action: 'allow' },
        { match: { kind: 'http', host: 'allowed.example.com' }, action: 'allow' },
        { match: { kind: 'http', host: 'blocked.example.com' }, action: 'deny' },
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

    // Create a simple target HTTP server
    targetServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        message: 'target reached',
      }));
    });
    await new Promise<void>((resolve) => {
      targetServer.listen(targetPort, '127.0.0.1', resolve);
    });

    httpProxy = new HttpProxy({
      port: proxyPort,
      consentGate,
      auditLogger,
    });
    await httpProxy.start();
  });

  after(async () => {
    await httpProxy.stop();
    await new Promise<void>((resolve) => {
      targetServer.close(() => resolve());
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('forwards allowed HTTP requests to target', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: `http://127.0.0.1:${targetPort}/test`,
      method: 'GET',
      headers: { Host: `127.0.0.1:${targetPort}` },
    });

    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.message, 'target reached');
    assert.strictEqual(body.method, 'GET');
  });

  it('blocks denied HTTP requests with 403', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: 'http://blocked.example.com/secret',
      method: 'GET',
      headers: { Host: 'blocked.example.com' },
    });

    assert.strictEqual(res.status, 403);
    const body = JSON.parse(res.body);
    assert.ok(body.error, 'should have error field');
  });
});
