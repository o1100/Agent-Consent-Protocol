/**
 * acp run -- <command>
 *
 * The main command. Starts the ACP proxy, optionally sets up network
 * isolation or Docker containment, shell command interception, and
 * HTTP proxy, then spawns the agent process in the sandbox.
 *
 * The agent connects to ACP as if it's a normal MCP server.
 * ACP intercepts all tool calls, checks policy, asks for consent,
 * and only then forwards to real MCP servers (with credentials injected).
 *
 * Shell commands are intercepted via PATH wrapper scripts.
 * HTTP requests are intercepted via a forward proxy.
 * Docker containment (--contained) provides kernel-enforced isolation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { McpProxy } from '../proxy/mcp-proxy.js';
import { HttpProxy } from '../proxy/http-proxy.js';
import { ConsentGate } from '../proxy/consent-gate.js';
import { createSandboxedProcess } from '../sandbox/process.js';
import { CredentialVault } from '../sandbox/credentials.js';
import { PolicyEngine } from '../policy/engine.js';
import { PolicyParser } from '../policy/parser.js';
import { AuditLogger } from '../audit/logger.js';
import { createChannel } from '../channels/terminal.js';
import { generateWrappers, cleanupWrappers } from '../interceptors/shell-wrappers.js';
import * as docker from '../sandbox/docker.js';
import type { UpstreamServerConfig } from '../proxy/upstream-manager.js';

const ACP_DIR = path.join(process.env.HOME || '~', '.acp');

interface RunOptions {
  networkIsolation: boolean;
  contained: boolean;
  interactive: boolean;
  image?: string;
  workspace?: string;
  env: string[];
  policy?: string;
  port: string;
  httpProxyPort: string;
  upstream?: string[];
  channel?: string;
  shellIntercept: boolean;
  httpIntercept: boolean;
}

export async function runCommand(
  command: string[],
  options: RunOptions
): Promise<void> {
  if (!command || command.length === 0) {
    console.error('  No command specified. Usage: acp run -- <command>');
    process.exit(1);
  }

  // Load config
  const configPath = path.join(ACP_DIR, 'config.yml');
  if (!fs.existsSync(configPath)) {
    console.error('  ACP not initialized. Run: acp init');
    process.exit(1);
  }

  const config = yamlParse(fs.readFileSync(configPath, 'utf-8'));
  const port = parseInt(options.port || config.proxy?.port || '8443', 10);
  const httpProxyPort = parseInt(options.httpProxyPort || config.http_proxy?.port || '8444', 10);

  // Determine which interceptors are active
  const shellIntercept = options.shellIntercept !== false && (config.shell_intercept?.enabled !== false);
  const httpIntercept = options.httpIntercept !== false && (config.http_proxy?.enabled !== false);
  const contained = options.contained === true;

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
    console.warn('  No policy file found. Using default: ask for everything.');
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
      const name = `cli-upstream-${i}`;
      upstreamServers.push({ name, command: cmd });
    }
  }

  // --- CONTAINED MODE: Docker orchestration ---
  if (contained) {
    await runContainedMode(command, options, {
      port, httpProxyPort, policyPath, policy, policyEngine, vault,
      auditLogger, channel, consentGate, upstreamServers, config,
      httpIntercept,
    });
    return;
  }

  // --- NON-CONTAINED MODE: v0.3 behavior ---
  // In non-contained mode, proxies listen on localhost only
  const listenAddress = '127.0.0.1';

  const proxy = new McpProxy({
    port,
    consentGate,
    auditLogger,
    upstreamServers,
    vault,
    listenAddress,
  });

  // Banner
  console.log('');
  console.log('  ACP v0.3.0 — Agent Consent Protocol');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Mode:      COOPERATIVE (proxy-only)`);
  console.log(`  Proxy:     http://127.0.0.1:${port}`);
  console.log(`  Policy:    ${policyPath}`);
  console.log(`  Channel:   ${config.channel}`);
  console.log(`  Audit:     ${path.join(ACP_DIR, 'audit.jsonl')}`);
  console.log(`  Command:   ${command.join(' ')}`);
  if (upstreamServers.length > 0) {
    console.log(`  Upstreams: ${upstreamServers.length} server(s)`);
    for (const us of upstreamServers) {
      console.log(`    -> ${us.name}: ${us.command || us.url}`);
    }
  }
  // Interceptors
  const interceptors: string[] = ['MCP'];
  if (shellIntercept) interceptors.push('Shell');
  if (httpIntercept) interceptors.push('HTTP');
  console.log(`  Intercept: ${interceptors.join(' + ')}`);
  if (httpIntercept) {
    console.log(`  HTTP Proxy: http://127.0.0.1:${httpProxyPort}`);
  }
  if (options.networkIsolation) {
    console.log('  Network:   Isolated (agent can only reach ACP proxy)');
  } else {
    console.log('  Network:   No isolation (proxy-only mode)');
  }
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Start MCP proxy (this also starts upstream servers)
  try {
    await proxy.start();
  } catch (err) {
    console.error(`  Failed to start proxy: ${(err as Error).message}`);
    process.exit(1);
  }

  // Start HTTP forward proxy if enabled
  let httpProxy: HttpProxy | undefined;
  if (httpIntercept) {
    httpProxy = new HttpProxy({
      port: httpProxyPort,
      consentGate,
      auditLogger,
      listenAddress,
    });
    try {
      await httpProxy.start();
    } catch (err) {
      console.warn(`  HTTP proxy failed: ${(err as Error).message}`);
      console.warn('  Continuing without HTTP interception.');
    }
  }

  // Generate shell wrappers if enabled
  let shellWrapperBinDir: string | undefined;
  if (shellIntercept) {
    try {
      const commands = config.shell_intercept?.commands;
      const failMode = config.shell_intercept?.fail_mode || 'deny';
      shellWrapperBinDir = generateWrappers({
        acpPort: port,
        commands,
        failMode,
      });
      console.log(`  Shell wrappers generated in ${shellWrapperBinDir}`);
    } catch (err) {
      console.warn(`  Shell wrapper generation failed: ${(err as Error).message}`);
      console.warn('  Continuing without shell interception.');
    }
  }

  // Network isolation (legacy --network-isolation flag, non-contained mode)
  // In v0.3, --contained is the recommended way. --network-isolation is kept for compat.
  if (options.networkIsolation) {
    console.warn('  --network-isolation is deprecated. Use --contained for Docker-based isolation.');
  }

  // Spawn the agent process
  const agentProcess = createSandboxedProcess(command, {
    proxyUrl: `http://127.0.0.1:${port}`,
    vault,
    networkIsolation: false,
    shellWrapperBinDir,
    httpProxyUrl: httpProxy ? `http://127.0.0.1:${httpProxyPort}` : undefined,
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
      contained: false,
      channel: config.channel,
      upstream_count: upstreamServers.length,
      shell_intercept: shellIntercept,
      http_intercept: httpIntercept,
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

    cleanupWrappers();
    if (httpProxy) {
      await httpProxy.stop();
    }
    await proxy.stop();
    process.exit(code ?? 0);
  });

  // Handle signals
  const cleanup = async () => {
    console.log('\n  Shutting down ACP...');
    agentProcess.kill('SIGTERM');
    cleanupWrappers();
    if (httpProxy) {
      await httpProxy.stop();
    }
    await proxy.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

/**
 * Run in Docker contained mode.
 *
 * ACP proxies run on the HOST, listening on 0.0.0.0 so the container
 * can reach them via the Docker bridge IP. The agent runs inside a
 * Docker container on an internal network with no internet access.
 */
async function runContainedMode(
  command: string[],
  options: RunOptions,
  ctx: {
    port: number;
    httpProxyPort: number;
    policyPath: string;
    policy: any;
    policyEngine: PolicyEngine;
    vault: CredentialVault;
    auditLogger: AuditLogger;
    channel: any;
    consentGate: ConsentGate;
    upstreamServers: UpstreamServerConfig[];
    config: any;
    httpIntercept: boolean;
  }
): Promise<void> {
  const { port, httpProxyPort, policyPath, auditLogger, consentGate, upstreamServers, config, vault, httpIntercept } = ctx;
  const interactive = options.interactive === true;

  // Validate: --interactive requires a non-terminal consent channel
  if (interactive && (!config.channel || config.channel === 'prompt' || config.channel === 'terminal')) {
    console.error('  --interactive requires a non-terminal consent channel (e.g. --channel=telegram).');
    console.error('  Both the agent and ACP cannot share stdin. Use:');
    console.error('    acp run --contained --interactive --channel=telegram -- claude');
    process.exit(1);
  }

  // 1. Preflight: check Docker is available
  try {
    docker.preflight();
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Create internal network
  docker.ensureNetwork();

  // 3. Get bridge gateway IP
  const gatewayIp = docker.getGatewayIp();

  // 4. Resolve image
  const image = options.image || docker.detectImage(command);

  // 5. Pull image
  docker.pullImage(image);

  // 6. Workspace directory
  const workspaceDir = options.workspace || process.cwd();

  // In contained mode, proxies listen on 0.0.0.0 so the container can reach them
  const listenAddress = '0.0.0.0';

  // Start MCP proxy
  const proxy = new McpProxy({
    port,
    consentGate,
    auditLogger,
    upstreamServers,
    vault,
    listenAddress,
  });

  // Banner
  console.log('');
  console.log('  ACP v0.3.0 — Agent Consent Protocol');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Mode:      CONTAINED (Docker)`);
  console.log(`  Network:   acp-jail (${gatewayIp}) — no internet access`);
  console.log(`  Image:     ${image}`);
  console.log(`  Workspace: ${workspaceDir}`);
  console.log(`  Proxy:     http://${gatewayIp}:${port}`);
  console.log(`  HTTP:      http://${gatewayIp}:${httpProxyPort}`);
  console.log(`  Policy:    ${policyPath}`);
  console.log(`  Channel:   ${config.channel}`);
  console.log(`  Audit:     ${path.join(ACP_DIR, 'audit.jsonl')}`);
  console.log(`  Command:   ${command.join(' ')}`);
  if (upstreamServers.length > 0) {
    console.log(`  Upstreams: ${upstreamServers.length} server(s)`);
    for (const us of upstreamServers) {
      console.log(`    -> ${us.name}: ${us.command || us.url}`);
    }
  }
  console.log('  ─────────────────────────────────────────');
  console.log('');

  try {
    await proxy.start();
  } catch (err) {
    console.error(`  Failed to start proxy: ${(err as Error).message}`);
    process.exit(1);
  }

  // Start HTTP forward proxy (always enabled in contained mode)
  let httpProxy: HttpProxy | undefined;
  if (httpIntercept) {
    httpProxy = new HttpProxy({
      port: httpProxyPort,
      consentGate,
      auditLogger,
      listenAddress,
    });
    try {
      await httpProxy.start();
    } catch (err) {
      console.warn(`  HTTP proxy failed: ${(err as Error).message}`);
      console.warn('  Continuing without HTTP interception.');
    }
  }

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
      contained: true,
      image,
      workspace: workspaceDir,
      gateway_ip: gatewayIp,
      channel: config.channel,
      upstream_count: upstreamServers.length,
    },
  });

  // Spawn the agent inside Docker
  console.log(`  Starting contained agent: ${command.join(' ')}`);
  console.log('');

  // Forward host env vars into the container
  const forwardedEnv: Record<string, string> = {};
  if (options.env) {
    for (const key of options.env) {
      const val = process.env[key];
      if (val) {
        forwardedEnv[key] = val;
      } else {
        console.warn(`  Warning: env var ${key} is not set on host, skipping.`);
      }
    }
  }

  const agentProcess: ChildProcess = docker.runContained({
    image,
    command,
    workspaceDir,
    proxyHost: gatewayIp,
    proxyPort: port,
    httpProxyPort,
    interactive,
    env: forwardedEnv,
  });

  // Handle process exit
  agentProcess.on('exit', async (code: number | null) => {
    console.log(`\n  Agent container exited with code ${code}`);

    auditLogger.record({
      event_type: 'session_ended',
      agent: command.join(' '),
      tool: '-',
      category: 'system',
      risk_level: 'low',
      metadata: { exit_code: code, contained: true },
    });

    docker.cleanup();
    if (httpProxy) {
      await httpProxy.stop();
    }
    await proxy.stop();
    process.exit(code ?? 0);
  });

  // Handle signals
  const cleanupFn = async () => {
    console.log('\n  Shutting down ACP...');
    agentProcess.kill('SIGTERM');
    docker.cleanup();
    if (httpProxy) {
      await httpProxy.stop();
    }
    await proxy.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanupFn);
  process.on('SIGTERM', cleanupFn);
}
