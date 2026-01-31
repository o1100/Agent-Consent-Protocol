/**
 * HTTP Proxy for non-MCP traffic
 *
 * Optional layer that intercepts HTTP requests from the agent
 * (when network isolation forces all traffic through ACP).
 * This handles regular HTTP/HTTPS requests that aren't MCP protocol.
 *
 * In the current MVP, this is a placeholder. The primary proxy
 * is the MCP proxy. HTTP proxying will be added for agents that
 * make direct API calls (not through MCP tools).
 */

import http from 'node:http';

interface HttpProxyOptions {
  port: number;
  allowedHosts?: string[];
}

/**
 * Forward HTTP proxy for network-isolated agents.
 *
 * When network isolation is active, the agent can't reach the
 * internet directly. This proxy can selectively forward HTTP
 * requests to approved hosts.
 */
export class HttpProxy {
  private server: http.Server | null = null;
  private port: number;
  private allowedHosts: Set<string>;

  constructor(options: HttpProxyOptions) {
    this.port = options.port;
    this.allowedHosts = new Set(options.allowedHosts || []);
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const host = url.hostname;

      // Check if the host is allowed
      if (this.allowedHosts.size > 0 && !this.allowedHosts.has(host)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Blocked by ACP',
          message: `Host "${host}" is not in the allowed list.`,
        }));
        return;
      }

      // For MVP, return a clear message that HTTP proxying is not yet implemented
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Not implemented',
        message: 'HTTP proxy forwarding is not yet implemented. Use MCP tools.',
      }));
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
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
}
