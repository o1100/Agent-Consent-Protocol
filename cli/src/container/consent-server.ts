/**
 * Consent Server — HTTP server on :8443 for shell wrapper callbacks
 *
 * Shell wrappers inside the container POST to this endpoint to ask
 * for permission before executing a command.
 *
 * POST /consent
 *   { "name": "gh", "args": "commit -m msg" }
 *   => { "approved": true, "token": "abc123" }
 *   or { "approved": false, "reason": "Denied by policy" }
 *
 * The token is used to avoid double-prompting at Layer 2 (HTTP proxy).
 * When Layer 1 approves a command, the token is stored in a shared set.
 * The HTTP proxy checks for active tokens and auto-allows traffic.
 */

import http from 'node:http';
import type { ConsentGate } from '../core/gate.js';
import type { Action } from '../core/types.js';

// Shared approval tokens: token => expiry timestamp
// Used to avoid double-prompting between Layer 1 and Layer 2
const approvalTokens = new Map<string, number>();
const TOKEN_TTL_MS = 60_000;

export function addApprovalToken(token: string, ttlMs: number = TOKEN_TTL_MS): void {
  approvalTokens.set(token, Date.now() + ttlMs);
}

export function hasValidApprovalToken(): boolean {
  const now = Date.now();
  for (const [token, expiry] of approvalTokens) {
    if (expiry > now) return true;
    approvalTokens.delete(token);
  }
  return false;
}

export function clearExpiredTokens(): void {
  const now = Date.now();
  for (const [token, expiry] of approvalTokens) {
    if (expiry <= now) approvalTokens.delete(token);
  }
}

interface ConsentServerOptions {
  port: number;
  gate: ConsentGate;
  listenAddress?: string;
}

export class ConsentServer {
  private server: http.Server | null = null;
  private port: number;
  private gate: ConsentGate;
  private listenAddress: string;

  constructor(options: ConsentServerOptions) {
    this.port = options.port;
    this.gate = options.gate;
    this.listenAddress = options.listenAddress || '0.0.0.0';
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/consent') {
        await this.handleConsent(req, res);
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Consent server port ${this.port} is already in use`));
        } else {
          reject(err);
        }
      });

      this.server!.listen(this.port, this.listenAddress, () => {
        console.log(`  Consent server listening on http://${this.listenAddress}:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleConsent(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let parsed: { name?: string; args?: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ approved: false, reason: 'Invalid JSON' }));
      return;
    }

    if (!parsed.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ approved: false, reason: 'Missing "name" field' }));
      return;
    }

    const action: Action = {
      name: parsed.name,
      args: parsed.args,
      meta: { kind: 'shell' },
    };

    try {
      const verdict = await this.gate(action);

      if (verdict.decision === 'allow') {
        // Generate an approval token to avoid double-prompting at Layer 2
        const token = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        addApprovalToken(token);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ approved: true, token }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ approved: false, reason: verdict.reason }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        approved: false,
        reason: `Gate error: ${(err as Error).message}`,
      }));
    }
  }
}
