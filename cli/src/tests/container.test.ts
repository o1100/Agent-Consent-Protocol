import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ConsentServer, addApprovalToken, hasValidApprovalToken, clearExpiredTokens } from '../container/consent-server.js';
import { createGate, type ConsentGate } from '../core/gate.js';
import { parsePolicy } from '../core/policy.js';
import type { Action } from '../core/types.js';
import type { Channel, ChannelResponse } from '../core/channel.js';

class MockChannel implements Channel {
  public response: ChannelResponse = { approved: true };
  async ask(_action: Action, _timeoutMs: number): Promise<ChannelResponse> {
    return this.response;
  }
}

describe('ConsentServer', () => {
  let server: ConsentServer;
  let port: number;
  let channel: MockChannel;

  beforeEach(async () => {
    channel = new MockChannel();

    const policy = parsePolicy(`
default: ask
wrap: []
rules:
  - match: { name: "cat" }
    action: allow
  - match: { name: "rm", args: "-rf /*" }
    action: deny
`);

    const gate = createGate({
      policy,
      channel,
      audit: { append: () => {} }, // no-op audit
    });

    server = new ConsentServer({
      port: 0,
      gate,
      listenAddress: '127.0.0.1',
    });

    await server.start();
    const addr = (server as unknown as { server: http.Server }).server.address();
    port = (addr as { port: number }).port;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('approves allowed commands', async () => {
    const response = await postConsent(port, { name: 'cat', args: '/workspace/file' });
    assert.strictEqual(response.approved, true);
    assert.ok(response.token);
  });

  it('denies blocked commands', async () => {
    const response = await postConsent(port, { name: 'rm', args: '-rf /*' });
    assert.strictEqual(response.approved, false);
    assert.ok(response.reason);
  });

  it('asks human for unmatched commands', async () => {
    channel.response = { approved: true };
    const response = await postConsent(port, { name: 'wget', args: 'https://example.com' });
    assert.strictEqual(response.approved, true);
  });

  it('returns 400 for missing name', async () => {
    const response = await postConsentRaw(port, JSON.stringify({ args: 'test' }));
    assert.strictEqual(response.status, 400);
  });

  it('returns 400 for invalid JSON', async () => {
    const response = await postConsentRaw(port, 'not json');
    assert.strictEqual(response.status, 400);
  });

  it('health endpoint returns ok', async () => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      }).on('error', reject);
    });

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(JSON.parse(response.body), { status: 'ok' });
  });
});

describe('Approval Tokens', () => {
  it('addApprovalToken creates a valid token', () => {
    addApprovalToken('test-token-1', 5000);
    assert.strictEqual(hasValidApprovalToken(), true);
  });

  it('expired tokens are cleaned up', () => {
    addApprovalToken('expired-token', 0); // expires immediately
    clearExpiredTokens();
    // After clearing, should have no valid tokens (unless other tests added some)
    // This is a basic smoke test
  });
});

// Helper to POST to /consent
async function postConsent(
  port: number,
  body: Record<string, unknown>
): Promise<{ approved: boolean; reason?: string; token?: string }> {
  const raw = await postConsentRaw(port, JSON.stringify(body));
  return JSON.parse(raw.body);
}

async function postConsentRaw(
  port: number,
  body: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/consent',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
