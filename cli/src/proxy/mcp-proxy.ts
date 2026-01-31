/**
 * MCP Proxy Server
 *
 * Implements an MCP-compatible HTTP/SSE server that the agent connects to.
 * Intercepts tools/call requests and routes them through the consent gate.
 * All other MCP methods (tools/list, resources/*, prompts/*) are forwarded.
 *
 * Supports upstream MCP servers via:
 * - Stdio transport (spawn process, pipe JSON-RPC)
 * - HTTP transport (forward to HTTP endpoint)
 */

import http from 'node:http';
import { ConsentGate } from './consent-gate.js';
import { UpstreamManager, UpstreamServerConfig } from './upstream-manager.js';
import { AuditLogger } from '../audit/logger.js';
import { CredentialVault } from '../sandbox/credentials.js';

interface McpProxyOptions {
  port: number;
  consentGate: ConsentGate;
  auditLogger: AuditLogger;
  upstreamServers: UpstreamServerConfig[];
  vault?: CredentialVault;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Proxy that intercepts tool calls and enforces consent.
 *
 * The agent sees this as a normal MCP server. Under the hood,
 * every tools/call goes through the consent gate before reaching
 * the real MCP server.
 */
export class McpProxy {
  private server: http.Server | null = null;
  private port: number;
  private consentGate: ConsentGate;
  private auditLogger: AuditLogger;
  private upstreamManager: UpstreamManager;
  private upstreamConfigs: UpstreamServerConfig[];
  private ready = false;

  constructor(options: McpProxyOptions) {
    this.port = options.port;
    this.consentGate = options.consentGate;
    this.auditLogger = options.auditLogger;
    this.upstreamConfigs = options.upstreamServers;
    this.upstreamManager = new UpstreamManager(options.vault);
  }

  /**
   * Start the MCP proxy server.
   */
  async start(): Promise<void> {
    // Start upstream servers first
    for (const config of this.upstreamConfigs) {
      try {
        await this.upstreamManager.addServer(config);
      } catch (err) {
        console.error(`  ❌ Failed to start upstream "${config.name}": ${(err as Error).message}`);
      }
    }

    // Discover tools from all upstreams
    if (this.upstreamManager.hasUpstreams) {
      await this.upstreamManager.discoverTools();
    }

    // Create HTTP server
    this.server = http.createServer(async (req, res) => {
      // CORS headers for MCP clients
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await readBody(req);
        const rpcRequest = JSON.parse(body) as JsonRpcRequest;
        const response = await this.handleRpcRequest(rpcRequest);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (err) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: -32600,
            message: (err as Error).message || 'Invalid request',
          },
        };
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorResponse));
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`  ❌ Port ${this.port} is already in use.`);
          console.error(`  Try: acp run --port ${this.port + 1} -- <command>`);
          reject(err);
        } else {
          reject(err);
        }
      });

      this.server!.listen(this.port, '127.0.0.1', () => {
        this.ready = true;
        console.log(`  🔌 ACP proxy listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the proxy server and all upstream servers.
   */
  async stop(): Promise<void> {
    this.ready = false;
    await this.upstreamManager.stopAll();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle an incoming MCP JSON-RPC request.
   */
  private async handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);

      case 'notifications/initialized':
        // Client notification, acknowledge silently
        return { jsonrpc: '2.0', id: request.id, result: {} };

      case 'tools/list':
        return this.handleToolsList(request);

      case 'tools/call':
        return this.handleToolsCall(request);

      case 'ping':
        return { jsonrpc: '2.0', id: request.id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  }

  /**
   * Handle MCP initialize request.
   */
  private handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'acp-proxy',
          version: '0.2.4',
        },
      },
    };
  }

  /**
   * Handle tools/list — returns aggregated tools from all upstream servers.
   */
  private handleToolsList(request: JsonRpcRequest): JsonRpcResponse {
    const tools = this.upstreamManager.getTools().map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tools },
    };
  }

  /**
   * Handle tools/call — THE CORE of ACP.
   *
   * 1. Intercept the tool call
   * 2. Run through policy engine
   * 3. If "ask": send to consent gate, wait for human decision
   * 4. If approved: forward to upstream, return real result
   * 5. If denied: return error to agent
   * 6. Log everything
   */
  private async handleToolsCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params || {};
    const toolName = params.name as string;
    const args = (params.arguments || {}) as Record<string, unknown>;

    if (!toolName) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32602,
          message: 'Missing tool name in tools/call request',
        },
      };
    }

    // Log the interception
    this.auditLogger.record({
      event_type: 'tool_call_intercepted',
      agent: 'sandbox-agent',
      tool: toolName,
      category: 'unknown',
      risk_level: 'medium',
      metadata: { arguments: args },
    });

    try {
      // Run through consent gate (policy check + human approval if needed)
      const result = await this.consentGate.process({
        tool: toolName,
        arguments: args,
        requestId: request.id,
      });

      if (result.allowed) {
        // Tool call was approved — forward to upstream
        const finalArgs = result.modifiedArgs || args;

        let toolResult: unknown;

        if (this.upstreamManager.hasUpstreams) {
          // Forward to the actual upstream MCP server
          try {
            toolResult = await this.upstreamManager.callTool(toolName, finalArgs);
          } catch (err) {
            const errMsg = (err as Error).message;
            console.error(`  ❌ Upstream call failed: ${errMsg}`);

            this.auditLogger.record({
              event_type: 'tool_call_error',
              agent: 'sandbox-agent',
              tool: toolName,
              category: result.category || 'unknown',
              risk_level: result.riskLevel || 'medium',
              decision: 'error',
              metadata: { error: errMsg },
            });

            return {
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32603,
                message: `Upstream error: ${errMsg}`,
              },
            };
          }
        } else {
          // No upstream servers — return a placeholder
          toolResult = {
            content: [
              {
                type: 'text',
                text: `Tool "${toolName}" approved but no upstream server configured.`,
              },
            ],
          };
        }

        this.auditLogger.record({
          event_type: 'tool_call_forwarded',
          agent: 'sandbox-agent',
          tool: toolName,
          category: result.category || 'unknown',
          risk_level: result.riskLevel || 'medium',
          decision: 'approved',
          metadata: { arguments: finalArgs },
        });

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: toolResult,
        };
      } else {
        // Tool call was denied
        this.auditLogger.record({
          event_type: 'tool_call_denied',
          agent: 'sandbox-agent',
          tool: toolName,
          category: result.category || 'unknown',
          risk_level: result.riskLevel || 'medium',
          decision: 'denied',
          metadata: { reason: result.reason },
        });

        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: result.reason || 'Tool call denied by ACP consent gate.',
          },
        };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: `ACP internal error: ${(err as Error).message}`,
        },
      };
    }
  }
}

/**
 * Read the full body of an HTTP request.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
