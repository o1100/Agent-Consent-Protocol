/**
 * Upstream MCP Server Manager
 *
 * Manages connections to upstream MCP servers via:
 * - Stdio transport (spawn process, communicate via stdin/stdout JSON-RPC)
 * - HTTP transport (forward requests to HTTP endpoint)
 *
 * Handles:
 * - Spawning and lifecycle of stdio servers
 * - Tool discovery (tools/list) across all upstreams
 * - Routing tool calls to the correct upstream
 * - Credential injection from vault into server environments
 * - Graceful shutdown
 */

import { spawn, ChildProcess } from 'node:child_process';
import { CredentialVault } from '../sandbox/credentials.js';

export interface UpstreamServerConfig {
  name: string;
  command?: string;
  url?: string;
  env?: Record<string, string>;
}

export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  serverName: string;
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
 * A single upstream MCP server connection (stdio transport).
 */
class StdioUpstream {
  name: string;
  private process: ChildProcess | null = null;
  private command: string;
  private env: Record<string, string>;
  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private buffer = '';
  private initialized = false;
  private dead = false;

  constructor(name: string, command: string, env: Record<string, string> = {}) {
    this.name = name;
    this.command = command;
    this.env = env;
  }

  /**
   * Spawn the upstream MCP server process.
   */
  async start(): Promise<void> {
    const parts = this.command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const processEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) processEnv[k] = v;
    }
    Object.assign(processEnv, this.env);

    this.process = spawn(cmd, args, {
      env: processEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    this.process.on('error', (err) => {
      console.error(`  ❌ Upstream "${this.name}" error: ${err.message}`);
      this.dead = true;
      this.rejectAll(new Error(`Upstream "${this.name}" died: ${err.message}`));
    });

    this.process.on('exit', (code) => {
      if (!this.dead) {
        console.error(`  ⚠️  Upstream "${this.name}" exited with code ${code}`);
      }
      this.dead = true;
      this.rejectAll(new Error(`Upstream "${this.name}" exited with code ${code}`));
    });

    // Handle stderr — log but don't crash
    this.process.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        // Many MCP servers log to stderr, don't spam unless it looks like an error
        if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('fatal')) {
          console.error(`  ⚠️  [${this.name}] ${msg}`);
        }
      }
    });

    // Handle stdout — JSON-RPC responses
    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Initialize the MCP connection
    await this.initialize();
  }

  /**
   * Process buffered stdout data, extracting complete JSON-RPC messages.
   */
  private processBuffer(): void {
    // MCP stdio uses newline-delimited JSON
    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) break;

      const line = this.buffer.substring(0, newlineIndex).trim();
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (!line) continue;

      try {
        const message = JSON.parse(line) as JsonRpcResponse;
        this.handleResponse(message);
      } catch {
        // Not valid JSON — might be a log line, ignore
      }
    }
  }

  /**
   * Handle an incoming JSON-RPC response.
   */
  private handleResponse(response: JsonRpcResponse): void {
    if (response.id === undefined || response.id === null) {
      // Notification — no pending request
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  /**
   * Send a JSON-RPC request to the upstream server.
   */
  async sendRequest(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<JsonRpcResponse> {
    if (this.dead || !this.process?.stdin?.writable) {
      throw new Error(`Upstream "${this.name}" is not available`);
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request to upstream "${this.name}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const data = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(data, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write to upstream "${this.name}": ${err.message}`));
        }
      });
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (this.dead || !this.process?.stdin?.writable) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * Initialize the MCP connection.
   */
  private async initialize(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'acp-proxy',
        version: '0.3.0',
      },
    });

    if (response.error) {
      throw new Error(`Failed to initialize upstream "${this.name}": ${response.error.message}`);
    }

    // Send initialized notification
    this.sendNotification('notifications/initialized');
    this.initialized = true;
  }

  /**
   * List tools from this upstream server.
   */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    if (!this.initialized) {
      throw new Error(`Upstream "${this.name}" not initialized`);
    }

    const response = await this.sendRequest('tools/list', {});
    if (response.error) {
      throw new Error(`Failed to list tools from "${this.name}": ${response.error.message}`);
    }

    const result = response.result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    return result?.tools || [];
  }

  /**
   * Call a tool on this upstream server.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized) {
      throw new Error(`Upstream "${this.name}" not initialized`);
    }

    const response = await this.sendRequest('tools/call', { name, arguments: args });
    if (response.error) {
      return {
        content: [{ type: 'text', text: `Error: ${response.error.message}` }],
        isError: true,
      };
    }

    return response.result;
  }

  /**
   * Stop the upstream server.
   */
  async stop(): Promise<void> {
    this.dead = true;
    this.rejectAll(new Error('Upstream shutting down'));

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // Give it 3 seconds to die gracefully
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 3000);

        this.process!.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /**
   * Reject all pending requests.
   */
  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  get isAlive(): boolean {
    return !this.dead && this.initialized;
  }
}

/**
 * A single upstream MCP server connection (HTTP transport).
 */
class HttpUpstream {
  name: string;
  private url: string;
  private initialized = false;

  constructor(name: string, url: string) {
    this.name = name;
    this.url = url;
  }

  async start(): Promise<void> {
    // Initialize the MCP connection via HTTP
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'acp-proxy',
        version: '0.3.0',
      },
    });

    if (response.error) {
      throw new Error(`Failed to initialize HTTP upstream "${this.name}": ${response.error.message}`);
    }

    // Send initialized notification
    await this.sendNotification('notifications/initialized');
    this.initialized = true;
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP upstream "${this.name}" returned ${response.status}`);
    }

    return await response.json() as JsonRpcResponse;
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const notification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });
    } catch {
      // Notifications are fire-and-forget
    }
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const response = await this.sendRequest('tools/list', {});
    if (response.error) {
      throw new Error(`Failed to list tools from HTTP upstream "${this.name}": ${response.error.message}`);
    }
    const result = response.result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    return result?.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.sendRequest('tools/call', { name, arguments: args });
    if (response.error) {
      return {
        content: [{ type: 'text', text: `Error: ${response.error.message}` }],
        isError: true,
      };
    }
    return response.result;
  }

  async stop(): Promise<void> {
    // Nothing to clean up for HTTP
  }

  get isAlive(): boolean {
    return this.initialized;
  }
}

/**
 * Manages all upstream MCP server connections.
 */
export class UpstreamManager {
  private upstreams = new Map<string, StdioUpstream | HttpUpstream>();
  private toolRegistry = new Map<string, UpstreamTool>();
  private vault: CredentialVault | null;

  constructor(vault?: CredentialVault) {
    this.vault = vault || null;
  }

  /**
   * Resolve ${vault:KEY} references in environment variables.
   */
  private resolveEnv(env: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') {
        resolved[key] = value.replace(/\$\{vault:([^}]+)\}/g, (_match, vaultKey: string) => {
          if (this.vault) {
            const secret = this.vault.get(vaultKey);
            if (secret) return secret;
            console.warn(`  ⚠️  Vault key "${vaultKey}" not found`);
          }
          return '';
        });
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  /**
   * Add and start an upstream server.
   */
  async addServer(config: UpstreamServerConfig): Promise<void> {
    const name = config.name;

    if (config.command) {
      // Stdio transport
      const env = config.env ? this.resolveEnv(config.env) : {};
      const upstream = new StdioUpstream(name, config.command, env);
      console.log(`  🔗 Starting upstream "${name}": ${config.command}`);
      await upstream.start();
      this.upstreams.set(name, upstream);
      console.log(`  ✅ Upstream "${name}" connected`);
    } else if (config.url) {
      // HTTP transport
      const upstream = new HttpUpstream(name, config.url);
      console.log(`  🔗 Connecting to HTTP upstream "${name}": ${config.url}`);
      await upstream.start();
      this.upstreams.set(name, upstream);
      console.log(`  ✅ HTTP upstream "${name}" connected`);
    } else {
      throw new Error(`Upstream "${name}" must have either "command" or "url"`);
    }
  }

  /**
   * Discover tools from all upstream servers.
   */
  async discoverTools(): Promise<UpstreamTool[]> {
    this.toolRegistry.clear();
    const allTools: UpstreamTool[] = [];

    for (const [name, upstream] of this.upstreams) {
      try {
        const tools = await upstream.listTools();
        for (const tool of tools) {
          const upstreamTool: UpstreamTool = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            serverName: name,
          };
          this.toolRegistry.set(tool.name, upstreamTool);
          allTools.push(upstreamTool);
        }
        console.log(`  📦 ${tools.length} tool(s) from "${name}"`);
      } catch (err) {
        console.error(`  ❌ Failed to discover tools from "${name}": ${(err as Error).message}`);
      }
    }

    return allTools;
  }

  /**
   * Get all discovered tools.
   */
  getTools(): UpstreamTool[] {
    return Array.from(this.toolRegistry.values());
  }

  /**
   * Find which upstream server owns a tool.
   */
  findToolServer(toolName: string): UpstreamTool | undefined {
    return this.toolRegistry.get(toolName);
  }

  /**
   * Call a tool on its upstream server.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found in any upstream server`);
    }

    const upstream = this.upstreams.get(tool.serverName);
    if (!upstream || !upstream.isAlive) {
      throw new Error(`Upstream server "${tool.serverName}" is not available`);
    }

    return upstream.callTool(toolName, args);
  }

  /**
   * Stop all upstream servers.
   */
  async stopAll(): Promise<void> {
    const stops = Array.from(this.upstreams.values()).map(u => u.stop());
    await Promise.allSettled(stops);
    this.upstreams.clear();
    this.toolRegistry.clear();
  }

  /**
   * Check if any upstream servers are configured.
   */
  get hasUpstreams(): boolean {
    return this.upstreams.size > 0;
  }
}
