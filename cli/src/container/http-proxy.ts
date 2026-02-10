/**
 * HTTP Forward Proxy — Layer 2 interception
 *
 * Intercepts all HTTP/HTTPS traffic from the container.
 * For each request:
 *   - HTTP: parse method + URL => consent gate => forward or 403
 *   - HTTPS (CONNECT): parse host:port => consent gate => tunnel or 403
 *
 * Checks for active approval tokens from Layer 1 to avoid
 * double-prompting the human.
 *
 * Uses only Node.js built-ins: http, net.
 */

import http from 'node:http';
import net from 'node:net';
import type { ConsentGate } from '../core/gate.js';
import type { Action } from '../core/types.js';
import { hasValidApprovalToken, clearExpiredTokens } from './consent-server.js';

interface HttpProxyOptions {
  port: number;
  gate: ConsentGate;
  listenAddress?: string;
}

export class HttpProxy {
  private server: http.Server | null = null;
  private port: number;
  private gate: ConsentGate;
  private listenAddress: string;

  constructor(options: HttpProxyOptions) {
    this.port = options.port;
    this.gate = options.gate;
    this.listenAddress = options.listenAddress || '0.0.0.0';
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    this.server.on('connect', (req, clientSocket: net.Socket, head) => {
      this.handleConnect(req, clientSocket, head);
    });

    return new Promise((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`HTTP proxy port ${this.port} is already in use`));
        } else {
          reject(err);
        }
      });

      this.server!.listen(this.port, this.listenAddress, () => {
        console.log(`  HTTP proxy listening on http://${this.listenAddress}:${this.port}`);
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

  /**
   * Handle plain HTTP requests.
   */
  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const fullUrl = req.url || '';
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      try {
        parsedUrl = new URL(fullUrl, `http://${req.headers.host}`);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid URL' }));
        return;
      }
    }

    const method = req.method || 'GET';
    const host = parsedUrl.hostname;

    // Check if Layer 1 already approved this traffic
    clearExpiredTokens();
    if (hasValidApprovalToken()) {
      this.forwardHttpRequest(req, res, parsedUrl, method);
      return;
    }

    const action: Action = {
      name: `http:${method}`,
      args: fullUrl,
      meta: {
        kind: 'http',
        host,
        method,
        port: parseInt(parsedUrl.port) || 80,
      },
    };

    try {
      const verdict = await this.gate(action);

      if (verdict.decision === 'deny') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Blocked by ACP',
          reason: verdict.reason,
        }));
        return;
      }
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'ACP proxy error',
        reason: (err as Error).message,
      }));
      return;
    }

    this.forwardHttpRequest(req, res, parsedUrl, method);
  }

  private forwardHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: URL,
    method: string
  ): void {
    const port = parseInt(parsedUrl.port) || 80;
    const forwardOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: { ...req.headers },
    };

    delete (forwardOptions.headers as Record<string, unknown>)['proxy-connection'];

    const proxyReq = http.request(forwardOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream connection failed', reason: err.message }));
      }
    });

    req.pipe(proxyReq, { end: true });
  }

  /**
   * Handle HTTPS CONNECT tunneling.
   * Domain-level consent only (encrypted content is not inspected).
   */
  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): Promise<void> {
    const target = req.url || '';
    const [host, portStr] = target.split(':');
    const port = parseInt(portStr) || 443;

    // Check if Layer 1 already approved this traffic
    clearExpiredTokens();
    if (hasValidApprovalToken()) {
      this.establishTunnel(host, port, clientSocket, head);
      return;
    }

    const action: Action = {
      name: 'http:CONNECT',
      args: target,
      meta: {
        kind: 'http',
        host,
        method: 'CONNECT',
        port,
      },
    };

    try {
      const verdict = await this.gate(action);

      if (verdict.decision === 'deny') {
        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.end();
        return;
      }
    } catch {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      return;
    }

    this.establishTunnel(host, port, clientSocket, head);
  }

  private establishTunnel(
    host: string,
    port: number,
    clientSocket: net.Socket,
    head: Buffer
  ): void {
    const serverSocket = net.connect({ host, port, timeout: 30000 }, () => {
      // Connection established — disable the idle timeout so long-lived
      // tunnels (e.g. Telegram long-poll) aren't killed prematurely.
      serverSocket.setTimeout(0);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        serverSocket.write(head);
      }
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('timeout', () => {
      // Only fires during initial connect (before setTimeout(0) above)
      serverSocket.destroy();
      if (clientSocket.writable) {
        clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
        clientSocket.end();
      }
    });

    serverSocket.on('error', (err) => {
      if (clientSocket.writable) {
        clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
        clientSocket.end();
      }
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });

    clientSocket.on('close', () => {
      serverSocket.destroy();
    });
  }
}
