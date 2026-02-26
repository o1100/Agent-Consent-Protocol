import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { HttpProxy } from '../container/http-proxy.js';
import type { Action, Verdict } from '../core/types.js';
import type { ConsentGate } from '../core/gate.js';

function createMockGate(decide: (action: Action) => 'allow' | 'deny'): ConsentGate {
  return async (action: Action): Promise<Verdict> => {
    const d = decide(action);
    return { decision: d, reason: `mock:${d}` };
  };
}

function connectThroughProxy(
  proxyPort: number,
  targetHost: string,
  targetPort: number,
): Promise<{ statusCode: number; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
    });
    req.on('connect', (res, socket) => {
      resolve({ statusCode: res.statusCode || 0, socket });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('HttpProxy CONNECT tunneling', () => {
  let proxy: HttpProxy;
  let echoServer: net.Server;
  let echoPort: number;
  let proxyPort: number;

  beforeEach(async () => {
    // TCP echo server
    echoServer = net.createServer((socket) => {
      socket.pipe(socket);
    });
    await new Promise<void>((resolve) => {
      echoServer.listen(0, '127.0.0.1', resolve);
    });
    echoPort = (echoServer.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    if (proxy) await proxy.stop();
    await new Promise<void>((resolve) => {
      echoServer.close(() => resolve());
    });
  });

  it('tunnels data through an allowed CONNECT', async () => {
    const gate = createMockGate(() => 'allow');
    proxy = new HttpProxy({ port: 0, gate, listenAddress: '127.0.0.1' });
    await proxy.start();
    const server = (proxy as unknown as { server: http.Server }).server;
    proxyPort = (server.address() as net.AddressInfo).port;

    const { statusCode, socket } = await connectThroughProxy(proxyPort, '127.0.0.1', echoPort);
    assert.strictEqual(statusCode, 200);

    // Send data through the tunnel and verify echo
    const echoed = await new Promise<string>((resolve, reject) => {
      let data = '';
      socket.on('data', (chunk) => { data += chunk.toString(); });
      socket.write('hello-acp');
      setTimeout(() => {
        socket.end();
        resolve(data);
      }, 100);
      socket.on('error', reject);
    });

    assert.ok(echoed.includes('hello-acp'), `Expected echo data, got: ${echoed}`);
  });

  it('rejects denied CONNECT with 403', async () => {
    const gate = createMockGate(() => 'deny');
    proxy = new HttpProxy({ port: 0, gate, listenAddress: '127.0.0.1' });
    await proxy.start();
    const server = (proxy as unknown as { server: http.Server }).server;
    proxyPort = (server.address() as net.AddressInfo).port;

    const { statusCode, socket } = await connectThroughProxy(proxyPort, '127.0.0.1', echoPort);
    assert.strictEqual(statusCode, 403);
    socket.destroy();
  });

  it('returns 502 when upstream is unreachable', async () => {
    const gate = createMockGate(() => 'allow');
    proxy = new HttpProxy({ port: 0, gate, listenAddress: '127.0.0.1' });
    await proxy.start();
    const server = (proxy as unknown as { server: http.Server }).server;
    proxyPort = (server.address() as net.AddressInfo).port;

    // Connect to a port that is not listening
    const { statusCode, socket } = await connectThroughProxy(proxyPort, '127.0.0.1', 1);
    assert.strictEqual(statusCode, 502);
    socket.destroy();
  });
});
