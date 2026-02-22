/**
 * acp start <preset>
 *
 * v0.3.0 VM mode:
 *   - Runs OpenClaw directly on Linux VM (no Docker)
 *   - Enforces per-user egress rules with nftables (fail closed)
 *   - Gates all proxy-mediated outbound HTTP/HTTPS via ACP consent gate
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { buildNodeOptions, parsePositivePort } from './start-utils.js';
import { loadPolicy, parsePolicy, Policy } from '../core/policy.js';
import { createGate } from '../core/gate.js';
import { FileAuditLog } from '../core/audit.js';
import { TelegramChannel, WebhookChannel, type Channel } from '../core/channel.js';
import { HttpProxy } from '../container/http-proxy.js';
import { acquireStartLock } from '../vm/start-lock.js';
import {
  ACP_NFT_TABLE,
  assertLinuxHost,
  assertNftablesAvailable,
  assertRoot,
  hasEgressRules,
  installEgressRules,
  removeEgressRules,
  resolveLinuxUserIdentity,
  type LinuxUserIdentity,
} from '../vm/nftables.js';

interface StartOptions {
  workspace?: string;
  config?: string;
  openclawUser?: string;
  httpProxyPort?: string;
}

const PRESETS: Record<string, true> = {
  openclaw: true,
};

export async function startCommand(
  preset: string,
  options: StartOptions
): Promise<void> {
  if (!PRESETS[preset]) {
    const available = Object.keys(PRESETS).join(', ');
    console.error(`  Unknown preset "${preset}". Available: ${available}`);
    process.exit(1);
  }

  if (preset === 'openclaw') {
    await startOpenClawVm(options);
  }
}

async function startOpenClawVm(options: StartOptions): Promise<void> {
  assertLinuxHost();
  assertRoot();
  assertNftablesAvailable();

  const runAsUsername = options.openclawUser || 'openclaw';
  const runAs = resolveLinuxUserIdentity(runAsUsername);
  if (runAs.uid === 0) {
    throw new Error('OpenClaw must run as a non-root user.');
  }

  const acpDir = options.config || path.join(runAs.homeDir, '.acp');
  const configPath = path.join(acpDir, 'config.yml');
  if (!fs.existsSync(configPath)) {
    console.error('');
    console.error(`  Missing ACP config: ${configPath}`);
    console.error(`  Run as ${runAs.username}: acp init --channel=telegram`);
    console.error('');
    process.exit(1);
  }
  const startLock = acquireStartLock(runAs.username);
  process.on('exit', () => {
    startLock.release();
  });

  const config = (yamlParse(fs.readFileSync(configPath, 'utf-8')) || {}) as Record<string, unknown>;
  const channelType = typeof config.channel === 'string' ? config.channel : 'prompt';

  const proxyPort = parsePositivePort(options.httpProxyPort || '8444', 'http-proxy-port');
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  // Prefer user policy, fallback to packaged OpenClaw template.
  const policyPath = resolvePolicyPath(acpDir, config);
  let policy: Policy;
  if (fs.existsSync(policyPath)) {
    policy = loadPolicy(policyPath);
  } else {
    policy = parsePolicy('default: ask\nwrap: []\nrules: []');
  }

  // Built-in allowlist for high-frequency safe APIs.
  const safeHosts = [
    'api.anthropic.com',
    '*.anthropic.com',
    'api.openai.com',
    '*.openai.com',
    'generativelanguage.googleapis.com',
    'api.search.brave.com',
    ...(channelType === 'telegram' ? ['api.telegram.org'] : []),
  ];
  for (const host of safeHosts) {
    policy.prependRule({
      match: { kind: 'http', host },
      action: 'allow',
    });
  }

  const channel = createChannel(channelType, config);
  const auditPath = path.join(acpDir, 'audit.jsonl');
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  const audit = new FileAuditLog(auditPath);
  const gate = createGate({ policy, channel, audit });

  const workspaceDir = options.workspace
    ? path.resolve(options.workspace)
    : path.join(runAs.homeDir, 'openclaw-workspace');

  const prepared = prepareOpenClawWorkspace({
    workspaceDir,
    runAs,
    proxyUrl,
  });

  // Load env values from OpenClaw config "env" section.
  const forwardedEnv = prepared.forwardEnv;
  const nodeOptions = buildNodeOptions(
    process.env.NODE_OPTIONS || '',
    [
      'global-agent/bootstrap',
      prepared.proxyBootstrapPath,
    ]
  );

  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...forwardedEnv,
    HOME: workspaceDir,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    GLOBAL_AGENT_HTTP_PROXY: proxyUrl,
    GLOBAL_AGENT_HTTPS_PROXY: proxyUrl,
    NODE_OPTIONS: nodeOptions,
    ACP_SANDBOX: '1',
    ACP_VM: '1',
    ACP_VERSION: '0.3.0',
  };

  const httpProxy = new HttpProxy({
    port: proxyPort,
    gate,
    listenAddress: '127.0.0.1',
  });

  let agentProcess: ChildProcess | null = null;
  let shuttingDown = false;
  let nftInstalled = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (agentProcess && !agentProcess.killed) {
      agentProcess.kill('SIGTERM');
    }
    if (nftInstalled || hasEgressRules(ACP_NFT_TABLE)) {
      removeEgressRules(ACP_NFT_TABLE);
    }
    await httpProxy.stop().catch(() => {});
    startLock.release();
    process.exit(exitCode);
  };
  process.on('SIGINT', () => {
    void shutdown(130);
  });
  process.on('SIGTERM', () => {
    void shutdown(143);
  });

  console.log('');
  console.log('  ACP v0.3.0 — Linux VM OpenClaw Mode');
  console.log('  ─────────────────────────────────────────');
  console.log('  Mode:      VM (no Docker)');
  console.log(`  User:      ${runAs.username} (uid=${runAs.uid})`);
  console.log(`  Workspace: ${workspaceDir}`);
  console.log(`  Policy:    ${policyPath}`);
  console.log(`  Channel:   ${channelType}`);
  console.log(`  Audit:     ${auditPath}`);
  console.log(`  Proxy:     ${proxyUrl}`);
  console.log(`  Egress:    nftables table ${ACP_NFT_TABLE}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');

  await httpProxy.start();
  installEgressRules({
    uid: runAs.uid,
    proxyPort,
    tableName: ACP_NFT_TABLE,
  });
  nftInstalled = true;

  console.log('  Starting OpenClaw gateway...');
  console.log('');

  agentProcess = spawn('node', ['node_modules/.bin/openclaw', 'gateway'], {
    cwd: workspaceDir,
    env: runtimeEnv,
    stdio: 'inherit',
    uid: runAs.uid,
    gid: runAs.gid,
  });

  agentProcess.on('error', async (err) => {
    console.error(`  Failed to start OpenClaw: ${err.message}`);
    await shutdown(1);
  });

  agentProcess.on('exit', async (code) => {
    console.log('');
    console.log(`  OpenClaw exited with code ${code ?? 0}`);
    await shutdown(code ?? 0);
  });
}

function resolvePolicyPath(
  acpDir: string,
  config: Record<string, unknown>
): string {
  const defaults = toRecord(config.defaults);
  const configured = typeof defaults?.policy === 'string' ? defaults.policy : '';
  if (configured) {
    return path.resolve(configured);
  }

  const userPolicy = path.join(acpDir, 'policy.yml');
  if (fs.existsSync(userPolicy)) {
    return userPolicy;
  }

  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..', '..', '..', 'templates', 'openclaw.yml'
  );
}

function prepareOpenClawWorkspace(options: {
  workspaceDir: string;
  runAs: LinuxUserIdentity;
  proxyUrl: string;
}): {
  forwardEnv: Record<string, string>;
  proxyBootstrapPath: string;
} {
  const { workspaceDir, runAs, proxyUrl } = options;
  const ocConfigSrc = path.join(runAs.homeDir, '.openclaw', 'openclaw.json');
  const setupTokenPath = path.join(runAs.homeDir, '.openclaw', '.acp-setup-token');
  const ocConfigDestDir = path.join(workspaceDir, '.openclaw');
  const ocConfigDestPath = path.join(ocConfigDestDir, 'openclaw.json');
  const proxyBootstrapPath = path.join(ocConfigDestDir, 'acp-proxy-bootstrap.cjs');

  if (!fs.existsSync(ocConfigSrc)) {
    console.error('');
    console.error(`  Missing OpenClaw config: ${ocConfigSrc}`);
    console.error(`  Run as ${runAs.username}: acp init --channel=telegram`);
    console.error('');
    process.exit(1);
  }

  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(ocConfigDestDir, { recursive: true });
  chownIfPossible(workspaceDir, runAs.uid, runAs.gid);
  chownIfPossible(ocConfigDestDir, runAs.uid, runAs.gid);

  const pkgJson = path.join(workspaceDir, 'package.json');
  const ocBin = path.join(workspaceDir, 'node_modules', '.bin', 'openclaw');
  if (!fs.existsSync(pkgJson)) {
    runCommandAsUser({
      command: 'npm',
      args: ['init', '-y', '--silent'],
      cwd: workspaceDir,
      runAs,
      inheritStdio: false,
    });
  }
  if (!fs.existsSync(ocBin)) {
    console.log('  Installing openclaw@latest...');
    runCommandAsUser({
      command: 'npm',
      args: ['install', 'openclaw@latest'],
      cwd: workspaceDir,
      runAs,
      inheritStdio: true,
    });
  }

  const globalAgentDist = path.join(workspaceDir, 'node_modules', 'global-agent', 'dist');
  if (!fs.existsSync(globalAgentDist)) {
    console.log('  Installing global-agent@2.2.0...');
    runCommandAsUser({
      command: 'npm',
      args: ['install', 'global-agent@2.2.0'],
      cwd: workspaceDir,
      runAs,
      inheritStdio: true,
    });
  }

  const rawConfig = JSON.parse(fs.readFileSync(ocConfigSrc, 'utf-8')) as Record<string, unknown>;
  const forwardEnv: Record<string, string> = {};

  const gateway = ensureRecord(rawConfig, 'gateway');
  gateway.auth = {
    mode: 'token',
    token: crypto.randomBytes(32).toString('hex'),
  };

  const channels = toRecord(rawConfig.channels);
  const telegram = channels ? toRecord(channels.telegram) : null;
  if (telegram) {
    telegram.proxy = proxyUrl;
  }

  const envVars = toRecord(rawConfig.env);
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      if (typeof value === 'string' && value.length > 0) {
        forwardEnv[key] = value;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawConfig, 'acp')) {
    delete rawConfig.acp;
  }

  fs.writeFileSync(ocConfigDestPath, JSON.stringify(rawConfig, null, 2) + '\n', 'utf-8');
  chownIfPossible(ocConfigDestPath, runAs.uid, runAs.gid);

  const proxyBootstrap = [
    'try {',
    "  const undici = require('undici');",
    "  const { ProxyAgent, setGlobalDispatcher } = undici;",
    "  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;",
    '  const stripDispatcher = (init) => {',
    "    if (!init || typeof init !== 'object' || !Object.prototype.hasOwnProperty.call(init, 'dispatcher')) return init;",
    "    const cloned = { ...init };",
    "    delete cloned.dispatcher;",
    '    return cloned;',
    '  };',
    '  const wrapFetch = (fetchImpl) => {',
    "    if (typeof fetchImpl !== 'function') return fetchImpl;",
    "    if (fetchImpl.__acpWrapped) return fetchImpl;",
    '    const wrapped = (input, init) => fetchImpl(input, stripDispatcher(init));',
    "    Object.defineProperty(wrapped, '__acpWrapped', { value: true });",
    '    return wrapped;',
    '  };',
    '  if (proxy) {',
    '    setGlobalDispatcher(new ProxyAgent(proxy));',
    '  }',
    "  if (typeof globalThis.fetch === 'function') {",
    '    globalThis.fetch = wrapFetch(globalThis.fetch);',
    '  }',
    "  if (typeof undici.fetch === 'function') {",
    '    undici.fetch = wrapFetch(undici.fetch);',
    '  }',
    '} catch (_err) {',
    '  // Best effort; global-agent still covers many HTTP clients.',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(proxyBootstrapPath, proxyBootstrap, 'utf-8');
  chownIfPossible(proxyBootstrapPath, runAs.uid, runAs.gid);

  if (fs.existsSync(setupTokenPath)) {
    try {
      const setupToken = fs.readFileSync(setupTokenPath, 'utf-8').trim();
      if (setupToken) {
        const agentsRootDir = path.join(ocConfigDestDir, 'agents');
        const agentMainDir = path.join(agentsRootDir, 'main');
        const agentDir = path.join(agentMainDir, 'agent');
        const authStorePath = path.join(agentDir, 'auth-profiles.json');
        fs.mkdirSync(agentDir, { recursive: true });
        chownIfPossible(agentsRootDir, runAs.uid, runAs.gid);
        chownIfPossible(agentMainDir, runAs.uid, runAs.gid);
        chownIfPossible(agentDir, runAs.uid, runAs.gid);
        let store: { version: number; profiles: Record<string, unknown> } = { version: 1, profiles: {} };
        try {
          store = JSON.parse(fs.readFileSync(authStorePath, 'utf-8')) as { version: number; profiles: Record<string, unknown> };
          if (!store.profiles || typeof store.profiles !== 'object') {
            store = { version: 1, profiles: {} };
          }
        } catch {
          store = { version: 1, profiles: {} };
        }

        store.profiles['anthropic:manual'] = {
          type: 'token',
          provider: 'anthropic',
          token: setupToken,
        };

        fs.writeFileSync(authStorePath, JSON.stringify(store, null, 2) + '\n', {
          mode: 0o600,
        });
        chownIfPossible(authStorePath, runAs.uid, runAs.gid);
        console.log('  Imported Claude setup-token into OpenClaw auth profiles.');
      }
    } catch (err) {
      console.error(`  Warning: failed to import setup-token: ${(err as Error).message}`);
    }
  }

  return { forwardEnv, proxyBootstrapPath };
}

function runCommandAsUser(options: {
  command: string;
  args: string[];
  cwd: string;
  runAs: LinuxUserIdentity;
  inheritStdio: boolean;
}): void {
  const { command, args, cwd, runAs, inheritStdio } = options;
  const result = spawnSync(command, args, {
    cwd,
    stdio: inheritStdio ? 'inherit' : 'pipe',
    env: {
      ...process.env,
      HOME: runAs.homeDir,
    },
    uid: runAs.uid,
    gid: runAs.gid,
    timeout: 300000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(`Command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
  }
}

function chownIfPossible(filePath: string, uid: number, gid: number): void {
  try {
    fs.chownSync(filePath, uid, gid);
  } catch {
    // Best effort.
  }
}

function createChannel(type: string, config: Record<string, unknown>): Channel {
  switch (type) {
    case 'telegram': {
      const telegram = toRecord(config.telegram);
      const botToken = (typeof telegram?.bot_token === 'string' ? telegram.bot_token : '') || process.env.ACP_TELEGRAM_BOT_TOKEN || '';
      const chatId = (typeof telegram?.chat_id === 'string' ? telegram.chat_id : '') || process.env.ACP_TELEGRAM_CHAT_ID || '';
      if (!botToken || !chatId) {
        throw new Error('Telegram bot token and chat ID are required. Run: acp init --channel=telegram');
      }
      return new TelegramChannel(botToken, chatId);
    }
    case 'webhook': {
      const webhook = toRecord(config.webhook);
      const url = (typeof webhook?.url === 'string' ? webhook.url : '') || process.env.ACP_WEBHOOK_URL || '';
      const secret = (typeof webhook?.secret === 'string' ? webhook.secret : undefined) || process.env.ACP_WEBHOOK_SECRET;
      if (!url) {
        throw new Error('Webhook URL required. Run: acp init --channel=webhook');
      }
      return new WebhookChannel(url, secret);
    }
    default:
      return new TerminalChannel();
  }
}

class TerminalChannel implements Channel {
  async ask(
    action: import('../core/types.js').Action,
    _timeoutMs: number
  ): Promise<{ approved: boolean; reason?: string }> {
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ensureRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = toRecord(obj[key]);
  if (current) return current;
  const created: Record<string, unknown> = {};
  obj[key] = created;
  return created;
}
