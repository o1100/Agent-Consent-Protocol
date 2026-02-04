/**
 * acp contain -- <agent command>
 *
 * The main command. Orchestrates the full containment setup:
 *   1. Load policy
 *   2. Create consent channel
 *   3. Start consent server (Layer 1: :8443)
 *   4. Start HTTP proxy (Layer 2: :8444)
 *   5. Generate shell wrappers from policy's `wrap` list
 *   6. Start Docker container with all isolation
 *   7. Wait for agent to exit, then clean up
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { loadPolicy, Policy, parsePolicy } from '../core/policy.js';
import { createGate, type ConsentGate } from '../core/gate.js';
import { TelegramChannel, WebhookChannel, type Channel } from '../core/channel.js';
import { FileAuditLog } from '../core/audit.js';
import { ConsentServer } from '../container/consent-server.js';
import { HttpProxy } from '../container/http-proxy.js';
import { generateWrappers, cleanupWrappers } from '../container/shell-wrappers.js';
import * as docker from '../container/docker.js';

const ACP_DIR = path.join(process.env.HOME || '~', '.acp');

interface ContainOptions {
  image?: string;
  workspace?: string;
  policy?: string;
  interactive: boolean;
  channel?: string;
  env: string[];
  consentPort: string;
  httpProxyPort: string;
}

export async function containCommand(
  command: string[],
  options: ContainOptions
): Promise<void> {
  if (!command || command.length === 0) {
    console.error('  No command specified. Usage: acp contain -- <command>');
    process.exit(1);
  }

  // Load config
  const configPath = path.join(ACP_DIR, 'config.yml');
  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    config = yamlParse(fs.readFileSync(configPath, 'utf-8')) || {};
  }

  // Determine channel
  const channelType = options.channel || (config.channel as string) || 'prompt';
  const interactive = options.interactive === true;

  // Validate: --interactive requires non-terminal consent channel
  if (interactive && (channelType === 'prompt' || channelType === 'terminal')) {
    console.error('  --interactive requires a non-terminal consent channel (e.g. --channel=telegram).');
    console.error('  Both the agent and ACP cannot share stdin. Use:');
    console.error('    acp contain --interactive --channel=telegram -- <command>');
    process.exit(1);
  }

  // Load policy
  const consentPort = parseInt(options.consentPort, 10);
  const httpProxyPort = parseInt(options.httpProxyPort, 10);

  let policy: Policy;
  const policyPath = options.policy || (config.defaults as Record<string, string>)?.policy || path.join(ACP_DIR, 'policy.yml');
  if (fs.existsSync(policyPath)) {
    policy = loadPolicy(policyPath);
  } else {
    console.warn('  No policy file found. Using default: ask for everything.');
    policy = parsePolicy('default: ask\nwrap: []\nrules: []');
  }

  // Create channel
  const channel = createChannel(channelType, config);

  // Create audit log
  const auditPath = path.join(ACP_DIR, 'audit.jsonl');
  const audit = new FileAuditLog(auditPath);

  // Create consent gate
  const gate = createGate({ policy, channel, audit });

  // --- Docker setup ---
  try {
    docker.preflight();
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }

  docker.ensureNetwork();
  const gatewayIp = docker.getGatewayIp();
  const image = options.image || docker.detectImage(command);
  docker.pullImage(image);
  const workspaceDir = options.workspace || process.cwd();

  // --- Start Layer 1: Consent server ---
  const consentServer = new ConsentServer({
    port: consentPort,
    gate,
    listenAddress: '0.0.0.0',
  });

  // --- Start Layer 2: HTTP proxy ---
  const httpProxy = new HttpProxy({
    port: httpProxyPort,
    gate,
    listenAddress: '0.0.0.0',
  });

  // Banner
  console.log('');
  console.log('  ACP v1.0 — Agent Consent Protocol');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Mode:      CONTAINED (Docker)`);
  console.log(`  Network:   acp-jail (${gatewayIp}) — no internet access`);
  console.log(`  Image:     ${image}`);
  console.log(`  Workspace: ${workspaceDir}`);
  console.log(`  Layer 1:   http://${gatewayIp}:${consentPort} (shell wrappers)`);
  console.log(`  Layer 2:   http://${gatewayIp}:${httpProxyPort} (HTTP proxy)`);
  console.log(`  Policy:    ${policyPath}`);
  console.log(`  Channel:   ${channelType}`);
  console.log(`  Audit:     ${auditPath}`);
  console.log(`  Wrap:      ${policy.wrap.length > 0 ? policy.wrap.join(', ') : '(none)'}`);
  console.log(`  Command:   ${command.join(' ')}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Start servers
  try {
    await consentServer.start();
  } catch (err) {
    console.error(`  Failed to start consent server: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    await httpProxy.start();
  } catch (err) {
    console.warn(`  HTTP proxy failed: ${(err as Error).message}`);
    console.warn('  Continuing without Layer 2 interception.');
  }

  // Generate shell wrappers from policy's wrap list
  let wrapperBinDir: string | undefined;
  if (policy.wrap.length > 0) {
    try {
      wrapperBinDir = generateWrappers({
        consentPort,
        consentHost: gatewayIp,
        commands: policy.wrap,
      });
      console.log(`  Shell wrappers generated: ${policy.wrap.join(', ')}`);
    } catch (err) {
      console.warn(`  Shell wrapper generation failed: ${(err as Error).message}`);
    }
  }

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

  // Start the agent in Docker
  console.log(`  Starting contained agent: ${command.join(' ')}`);
  console.log('');

  const agentProcess: ChildProcess = docker.runContained({
    image,
    command,
    workspaceDir,
    proxyHost: gatewayIp,
    consentPort,
    httpProxyPort,
    wrapperBinDir,
    interactive,
    env: forwardedEnv,
  });

  // Handle agent exit
  agentProcess.on('exit', async (code: number | null) => {
    console.log(`\n  Agent container exited with code ${code}`);

    cleanupAll(consentServer, httpProxy);
    process.exit(code ?? 0);
  });

  // Handle signals
  const shutdownFn = async () => {
    console.log('\n  Shutting down ACP...');
    agentProcess.kill('SIGTERM');
    cleanupAll(consentServer, httpProxy);
    process.exit(0);
  };

  process.on('SIGINT', shutdownFn);
  process.on('SIGTERM', shutdownFn);
}

function cleanupAll(consentServer: ConsentServer, httpProxy: HttpProxy): void {
  docker.cleanup();
  cleanupWrappers();
  consentServer.stop().catch(() => {});
  httpProxy.stop().catch(() => {});
}

function createChannel(type: string, config: Record<string, unknown>): Channel {
  switch (type) {
    case 'telegram': {
      const telegram = config.telegram as Record<string, string> | undefined;
      const botToken = telegram?.bot_token || process.env.ACP_TELEGRAM_BOT_TOKEN || '';
      const chatId = telegram?.chat_id || process.env.ACP_TELEGRAM_CHAT_ID || '';
      if (!botToken || !chatId) {
        console.error('  Telegram bot token and chat ID required.');
        console.error('  Run: acp init --channel=telegram');
        process.exit(1);
      }
      return new TelegramChannel(botToken, chatId);
    }
    case 'webhook': {
      const webhook = config.webhook as Record<string, string> | undefined;
      const url = webhook?.url || process.env.ACP_WEBHOOK_URL || '';
      const secret = webhook?.secret || process.env.ACP_WEBHOOK_SECRET;
      if (!url) {
        console.error('  Webhook URL required.');
        process.exit(1);
      }
      return new WebhookChannel(url, secret);
    }
    default: {
      // Terminal/prompt channel — use a simple inline implementation
      return new TerminalChannel();
    }
  }
}

/**
 * Terminal consent channel — for non-interactive (non-contained) usage.
 * Prompts on stdout/stdin.
 */
import readline from 'node:readline';

class TerminalChannel implements Channel {
  async ask(action: import('../core/types.js').Action, _timeoutMs: number): Promise<{ approved: boolean; reason?: string }> {
    console.log('');
    console.log('  ════════════════════════════════════════');
    console.log('    ACP CONSENT REQUEST');
    console.log('  ════════════════════════════════════════');

    if (action.meta.kind === 'shell') {
      console.log(`    Command: ${action.name}`);
      if (action.args) console.log(`    Args:    ${action.args}`);
    } else {
      console.log(`    HTTP:    ${action.meta.method || 'CONNECT'} ${action.meta.host}`);
      if (action.args) console.log(`    URL:     ${action.args}`);
    }

    console.log('  ════════════════════════════════════════');
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('  Approve? [y/N] ', (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (answer === 'y' || answer === 'yes') {
      return { approved: true };
    }
    return { approved: false, reason: answer === '' ? 'No response (default deny)' : 'User denied' };
  }
}
