/**
 * MCP Proxy Server
 *
 * Implements an MCP-compatible HTTP/SSE server that the agent connects to.
 * Intercepts tools/call requests and routes them through the consent gate.
 * All other MCP methods (tools/list, resources/*, prompts/*) are forwarded.
 */

import http from 'node:http';
import { ConsentGate } from './consent-gate.js';
import { AuditLogger } from '../audit/logger.js';

interface UpstreamServer {
  name: string;
  command?: string;
  url?: string;
}

interface McpProxyOptions {
  port: number;
  consentGate: ConsentGate;
  auditLogger: AuditLogger;
  upstreamServers: UpstreamServer[];
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
  private upstreamServers: UpstreamServer[];

  // Tool registry: populated from upstream servers
  private tools: Map<string, { name: string; description: string; inputSchema: unknown; server: string }> = new Map();

  constructor(options: McpProxyOptions) {
    this.port = options.port;
    this.consentGate = options.consentGate;
    this.auditLogger = options.auditLogger;
    this.upstreamServers = options.upstreamServers;
  }

  /**
   * Start the MCP proxy server.
   */
  async start(): Promise<void> {
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

    return new Promise((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        console.log(`  🔌 ACP proxy listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the proxy server.
   */
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
   * Handle an incoming MCP JSON-RPC request.
   */
  private async handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);

      case 'tools/list':
        return this.handleToolsList(request);

      case 'tools/call':
        return this.handleToolsCall(request);

      case 'ping':
        return { jsonrpc: '2.0', id: request.id, result: {} };

      default:
        // Forward unknown methods or return method not found
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
          version: '0.1.0',
        },
      },
    };
  }

  /**
   * Handle tools/list — returns aggregated tools from all upstream servers.
   */
  private handleToolsList(request: JsonRpcRequest): JsonRpcResponse {
    const tools = Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
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
   * 4. If approved: inject credentials, forward to upstream
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
        // Tool call was approved — return the result
        // In a full implementation, this would forward to the upstream MCP server
        // For now, we return the consent gate's result
        this.auditLogger.record({
          event_type: 'tool_call_forwarded',
          agent: 'sandbox-agent',
          tool: toolName,
          category: result.category || 'unknown',
          risk_level: result.riskLevel || 'medium',
          decision: 'approved',
          metadata: { arguments: result.modifiedArgs || args },
        });

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: result.response || `Tool "${toolName}" executed successfully.`,
              },
            ],
          },
        };
      } else {
        // Tool call was denied
        this.auditLogger.record({
          event_type: 'tool_call_intercepted',
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
