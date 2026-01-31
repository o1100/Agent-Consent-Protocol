/**
 * acp run -- <command>
 *
 * The main command. Starts the ACP proxy, optionally sets up network
 * isolation, and spawns the agent process in the sandbox.
 *
 * The agent connects to ACP as if it's a normal MCP server.
 * ACP intercepts all tool calls, checks policy, asks for consent,
 * and only then forwards to real MCP servers (with credentials injected).
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { McpProxy } from '../proxy/mcp-proxy.js';
import { ConsentGate } from '../proxy/consent-gate.js';
import { createSandboxedProcess } from '../sandbox/process.js';
import { setupNetworkIsolation, teardownNetworkIsolation } from '../sandbox/network.js';
import { CredentialVault } from '../sandbox/credentials.js';
import { PolicyEngine } from '../policy/engine.js';
import { PolicyParser } from '../policy/parser.js';
import { AuditLogger } from '../audit/logger.js';
import { createChannel } from '../channels/terminal.js';
import type { UpstreamServerConfig } from '../proxy/upstream-manager.js';

const ACP_DIR = path.join(process.env.HOME || '~', '.acp');

interface RunOptions {
  networkIsolation: boolean;
  policy?: string;
  port: string;
  upstream?: string[];
  channel?: string;
}

export async function runCommand(
  command: string[],
  options: RunOptions
): Promise<void> {
  if (!command || command.length === 0) {
    console.error('  ❌ No command specified. Usage: acp run -- <command>');
    process.exit(1);
  }

  // Load config
  const configPath = path.join(ACP_DIR, 'config.yml');
  if (!fs.existsSync(configPath)) {
    console.error('  ❌ ACP not initialized. Run: acp init');
    process.exit(1);
  }

  const config = yamlParse(fs.readFileSync(configPath, 'utf-8'));
  const port = parseInt(options.port || config.proxy?.port || '8443', 10);

  // Override channel if specified
  if (options.channel) {
    config.channel = options.channel;
  }

  // Load policy
  const policyPath = options.policy || config.defaults?.policy || path.join(ACP_DIR, 'policy.yml');
  let policy;
  if (fs.existsSync(policyPath)) {
    policy = PolicyParser.parseFile(policyPath);
  } else {
    console.warn('  ⚠️  No policy file found. Using default: ask for everything.');
    policy = { version: '1', default_action: 'ask' as const, rules: [] };
  }

  // Initialize components
  const policyEngine = new PolicyEngine(policy);
  const vault = new CredentialVault(path.join(ACP_DIR, 'vault.json'));
  const auditLogger = new AuditLogger(path.join(ACP_DIR, 'audit.jsonl'));
  const channel = createChannel(config);

  const consentGate = new ConsentGate({
    policyEngine,
    channel,
    vault,
    auditLogger,
    config,
  });

  // Build upstream server list from CLI flags + config
  const upstreamServers: UpstreamServerConfig[] = [];

  // Add upstream servers from config file
  const configUpstreams = config.proxy?.upstream_servers || [];
  for (const us of configUpstreams) {
    if (us.name && (us.command || us.url)) {
      upstreamServers.push(us as UpstreamServerConfig);
    }
  }

  // Add upstream servers from --upstream CLI flags
  if (options.upstream) {
    for (let i = 0; i < options.upstream.length; i++) {
      const cmd = options.upstream[i];
      // Generate a name from the command
      const name = `cli-upstream-${i}`;
      upstreamServers.push({ name, command: cmd });
    }
  }

  const proxy = new McpProxy({
    port,
    consentGate,
    auditLogger,
    upstreamServers,
    vault,
  });

  // Banner
  console.log('');
  console.log('  🔐 ACP — Agent Consent Protocol v0.2.4');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Proxy:      http://127.0.0.1:${port}`);
  console.log(`  Policy:     ${policyPath}`);
  console.log(`  Channel:    ${config.channel}`);
  console.log(`  Audit:      ${path.join(ACP_DIR, 'audit.jsonl')}`);
  console.log(`  Command:    ${command.join(' ')}`);
  if (upstreamServers.length > 0) {
    console.log(`  Upstreams:  ${upstreamServers.length} server(s)`);
    for (const us of upstreamServers) {
      console.log(`    → ${us.name}: ${us.command || us.url}`);
    }
  }
  if (options.networkIsolation) {
    console.log('  Network:    🔒 Isolated (agent can only reach ACP proxy)');
  } else {
    console.log('  Network:    ⚠️  No isolation (proxy-only mode)');
  }
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Start proxy (this also starts upstream servers)
  try {
    await proxy.start();
  } catch (err) {
    console.error(`  ❌ Failed to start proxy: ${(err as Error).message}`);
    process.exit(1);
  }

  // Set up network isolation if requested
  let cleanupNetwork: (() => Promise<void>) | undefined;
  if (options.networkIsolation) {
    try {
      cleanupNetwork = await setupNetworkIsolation(port);
      console.log('  🔒 Network isolation active');
    } catch (err) {
      console.warn(`  ⚠️  Network isolation failed: ${(err as Error).message}`);
      console.warn('  Continuing in proxy-only mode.');
    }
  }

  // Spawn the agent process
  const agentProcess = createSandboxedProcess(command, {
    proxyUrl: `http://127.0.0.1:${port}`,
    vault,
    networkIsolation: !!cleanupNetwork,
  });

  // Log startup
  auditLogger.record({
    event_type: 'session_started',
    agent: command.join(' '),
    tool: '-',
    category: 'system',
    risk_level: 'low',
    metadata: {
      command,
      port,
      network_isolation: !!cleanupNetwork,
      channel: config.channel,
      upstream_count: upstreamServers.length,
    },
  });

  // Handle process exit
  agentProcess.on('exit', async (code: number | null) => {
    console.log(`\n  Agent exited with code ${code}`);

    auditLogger.record({
      event_type: 'session_ended',
      agent: command.join(' '),
      tool: '-',
      category: 'system',
      risk_level: 'low',
      metadata: { exit_code: code },
    });

    if (cleanupNetwork) {
      await teardownNetworkIsolation();
    }
    await proxy.stop();
    process.exit(code ?? 0);
  });

  // Handle signals
  const cleanup = async () => {
    console.log('\n  Shutting down ACP...');
    agentProcess.kill('SIGTERM');
    if (cleanupNetwork) {
      await teardownNetworkIsolation();
    }
    await proxy.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
