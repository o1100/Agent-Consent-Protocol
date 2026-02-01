/**
 * HTTP Forward Proxy with ACP Consent
 *
 * Intercepts HTTP and HTTPS requests from the sandboxed agent process.
 * For each request:
 *   - HTTP: Parse method + URL → consent gate → forward or 403
 *   - HTTPS (CONNECT): Parse host:port → consent gate → TCP tunnel or 403
 *
 * HTTPS uses CONNECT tunneling (no MITM, no CA certs needed).
 * Domain-level control only for HTTPS; full URL for HTTP.
 *
 * Uses only Node.js built-ins: http, net.
 */

import http from 'node:http';
import net from 'node:net';
import { ConsentGate } from './consent-gate.js';
import { AuditLogger } from '../audit/logger.js';

interface HttpProxyOptions {
  port: number;
  consentGate: ConsentGate;
  auditLogger: AuditLogger;
  listenAddress?: string;
}

export class HttpProxy {
  private server: http.Server | null = null;
  private port: number;
  private consentGate: ConsentGate;
  private auditLogger: AuditLogger;
  private listenAddress: string;

  constructor(options: HttpProxyOptions) {
    this.port = options.port;
    this.consentGate = options.consentGate;
    this.auditLogger = options.auditLogger;
    this.listenAddress = options.listenAddress || '127.0.0.1';
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    // Handle CONNECT method for HTTPS tunneling
    this.server.on('connect', (req, clientSocket: net.Socket, head) => {
      this.handleConnect(req, clientSocket, head);
    });

    return new Promise((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`  ❌ HTTP proxy port ${this.port} is already in use.`);
          reject(err);
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
   * Handle plain HTTP requests (non-CONNECT).
   * Parse the full URL from the request line, check consent, then forward.
   */
  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const fullUrl = req.url || '';
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      // Relative URL — construct from host header
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
    const tool = `http:${method}`;

    // Check consent
    try {
      const result = await this.consentGate.process({
        tool,
        arguments: {
          method,
          url: fullUrl,
          host,
          path: parsedUrl.pathname,
        },
        requestId: `http_${Date.now().toString(36)}`,
        kind: 'http',
      });

      if (!result.allowed) {
        this.auditLogger.record({
          event_type: 'tool_call_denied',
          agent: 'sandbox-agent',
          tool,
          category: 'network',
          risk_level: 'medium',
          decision: 'denied',
          metadata: { url: fullUrl, reason: result.reason },
        });

        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Blocked by ACP',
          reason: result.reason || 'HTTP request denied by consent gate.',
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

    // Forward the request
    const port = parseInt(parsedUrl.port) || 80;
    const forwardOptions: http.RequestOptions = {
      hostname: host,
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: { ...req.headers },
    };

    // Remove proxy-specific headers
    delete (forwardOptions.headers as Record<string, unknown>)['proxy-connection'];

    const proxyReq = http.request(forwardOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      this.auditLogger.record({
        event_type: 'tool_call_error',
        agent: 'sandbox-agent',
        tool,
        category: 'network',
        risk_level: 'medium',
        decision: 'error',
        metadata: { url: fullUrl, error: err.message },
      });

      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream connection failed', reason: err.message }));
      }
    });

    req.pipe(proxyReq, { end: true });

    this.auditLogger.record({
      event_type: 'tool_call_forwarded',
      agent: 'sandbox-agent',
      tool,
      category: 'network',
      risk_level: 'medium',
      decision: 'approved',
      metadata: { url: fullUrl, method, host },
    });
  }

  /**
   * Handle HTTPS CONNECT tunneling.
   * Domain-level control: consent gate sees host:port but not the encrypted content.
   */
  private async handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): Promise<void> {
    const target = req.url || '';
    const [host, portStr] = target.split(':');
    const port = parseInt(portStr) || 443;

    // Check consent for the CONNECT tunnel
    try {
      const result = await this.consentGate.process({
        tool: 'http:CONNECT',
        arguments: { host, port, target },
        requestId: `connect_${Date.now().toString(36)}`,
        kind: 'http',
      });

      if (!result.allowed) {
        this.auditLogger.record({
          event_type: 'tool_call_denied',
          agent: 'sandbox-agent',
          tool: 'http:CONNECT',
          category: 'network',
          risk_level: 'medium',
          decision: 'denied',
          metadata: { host, port, reason: result.reason },
        });

        clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        clientSocket.end();
        return;
      }
    } catch {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      return;
    }

    // Establish TCP tunnel to the target
    const serverSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      // Send any buffered data
      if (head.length > 0) {
        serverSocket.write(head);
      }

      // Bidirectional pipe
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      this.auditLogger.record({
        event_type: 'tool_call_error',
        agent: 'sandbox-agent',
        tool: 'http:CONNECT',
        category: 'network',
        risk_level: 'medium',
        decision: 'error',
        metadata: { host, port, error: err.message },
      });

      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.end();
    });

    this.auditLogger.record({
      event_type: 'tool_call_forwarded',
      agent: 'sandbox-agent',
      tool: 'http:CONNECT',
      category: 'network',
      risk_level: 'medium',
      decision: 'approved',
      metadata: { host, port },
    });
  }
}
