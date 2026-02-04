import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebhookChannel } from '../core/channel.js';
import type { Action } from '../core/types.js';

describe('WebhookChannel', () => {
  it('sends POST to webhook URL and returns response', async () => {
    // Start a simple test server
    let receivedBody: string = '';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedBody = body;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ approved: true }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const channel = new WebhookChannel(`http://127.0.0.1:${addr.port}/consent`);

    const action: Action = {
      name: 'rm',
      args: 'important.txt',
      meta: { kind: 'shell' },
    };

    const response = await channel.ask(action, 5000);
    assert.strictEqual(response.approved, true);

    // Verify the webhook received the action
    const parsed = JSON.parse(receivedBody);
    assert.strictEqual(parsed.type, 'consent_request');
    assert.strictEqual(parsed.action.name, 'rm');

    server.close();
  });

  it('returns denied on webhook error', async () => {
    const channel = new WebhookChannel('http://127.0.0.1:1/nonexistent');

    const action: Action = {
      name: 'curl',
      meta: { kind: 'shell' },
    };

    const response = await channel.ask(action, 2000);
    assert.strictEqual(response.approved, false);
    assert.ok(response.reason?.includes('error'));
  });

  it('includes secret header when configured', async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ approved: false, reason: 'test' }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const channel = new WebhookChannel(
      `http://127.0.0.1:${addr.port}/consent`,
      'my-secret-key'
    );

    await channel.ask({ name: 'test', meta: { kind: 'shell' } }, 5000);
    assert.strictEqual(receivedHeaders['x-acp-secret'], 'my-secret-key');

    server.close();
  });
});
