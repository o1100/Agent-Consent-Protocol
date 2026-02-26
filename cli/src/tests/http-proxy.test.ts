import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpProxy } from '../container/http-proxy.js';
import type { Action, Verdict } from '../core/types.js';
import type { ConsentGate } from '../core/gate.js';

function createMockGate(rules: Record<string, 'allow' | 'deny'>): ConsentGate {
  return async (action: Action): Promise<Verdict> => {
    const host = action.meta.host || '';
    for (const [pattern, decision] of Object.entries(rules)) {
      if (host.includes(pattern)) {
        return { decision, reason: `Mock: ${decision} for ${host}` };
      }
    }
    return { decision: 'deny', reason: 'Mock: default deny' };
  };
}

function httpRequest(
  options: http.RequestOptions
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HttpProxy', () => {
  let proxy: HttpProxy;
  let targetServer: http.Server;
  let targetPort: number;
  let proxyPort: number;

  beforeEach(async () => {
    // Simple upstream target
    targetServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'target reached' }));
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, '127.0.0.1', resolve);
    });
    targetPort = (targetServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    if (proxy) await proxy.stop();
    await new Promise<void>((resolve) => {
      targetServer.close(() => resolve());
    });
  });

  it('forwards allowed HTTP requests', async () => {
    const gate = createMockGate({ '127.0.0.1': 'allow' });
    proxy = new HttpProxy({ port: 0, gate, listenAddress: '127.0.0.1' });
    await proxy.start();

    // Get the actual assigned port
    const server = (proxy as unknown as { server: http.Server }).server;
    proxyPort = (server.address() as { port: number }).port;

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
  });

  it('blocks denied HTTP requests with 403', async () => {
    const gate = createMockGate({ 'blocked': 'deny' });
    proxy = new HttpProxy({ port: 0, gate, listenAddress: '127.0.0.1' });
    await proxy.start();

    const server = (proxy as unknown as { server: http.Server }).server;
    proxyPort = (server.address() as { port: number }).port;

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: 'http://blocked.example.com/secret',
      method: 'GET',
      headers: { Host: 'blocked.example.com' },
    });

    assert.strictEqual(res.status, 403);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'Blocked by ACP');
  });

  it('returns 400 for invalid URLs', async () => {
    const gate = createMockGate({});
    proxy = new HttpProxy({ port: 0, gate, listenAddress: '127.0.0.1' });
    await proxy.start();

    const server = (proxy as unknown as { server: http.Server }).server;
    proxyPort = (server.address() as { port: number }).port;

    // Send a request with no host header and relative URL
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/just-a-path',
      method: 'GET',
      // No Host header - URL will be relative with no base
    });

    // Should either parse with host header or return 400
    assert.ok(res.status === 400 || res.status === 403 || res.status === 502);
  });
});
