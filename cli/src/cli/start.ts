/**
 * acp start <preset>
 *
 * Convenience command that sets up a workspace and runs a known agent
 * inside ACP containment. Currently supports the "openclaw" preset.
 *
 * Usage:
 *   acp start openclaw [--workspace=DIR] [--config=DIR]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { containCommand, type ContainOptions } from './contain.js';

interface StartOptions {
  workspace?: string;
  config?: string;
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
    await startOpenClaw(options);
  }
}

async function startOpenClaw(options: StartOptions): Promise<void> {
  const home = process.env.HOME || '~';
  const ocConfigSrc = path.join(home, '.openclaw', 'openclaw.json');

  // Stop any existing OpenClaw gateway running on the host.
  // This can happen if doctor --fix was run previously and enabled a systemd service.
  try {
    execSync('systemctl --user stop openclaw-gateway.service 2>/dev/null || true', {
      stdio: 'pipe',
      timeout: 5000,
    });
    execSync('systemctl --user disable openclaw-gateway.service 2>/dev/null || true', {
      stdio: 'pipe',
      timeout: 5000,
    });
    // Also kill any stray openclaw gateway processes
    execSync('pkill -f "openclaw.*gateway" 2>/dev/null || true', {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    // Ignore errors — service may not exist
  }

  // Check for OpenClaw config
  if (!fs.existsSync(ocConfigSrc)) {
    console.error('');
    console.error('  Missing ~/.openclaw/openclaw.json');
    console.error('  Run "acp init --channel=telegram" first to generate it.');
    console.error('');
    process.exit(1);
  }

  // Resolve workspace
  const workspaceDir = options.workspace
    ? path.resolve(options.workspace)
    : path.join(home, 'openclaw-workspace');

  // Set up workspace if needed
  const pkgJson = path.join(workspaceDir, 'package.json');
  const ocBin = path.join(workspaceDir, 'node_modules', '.bin', 'openclaw');

  if (!fs.existsSync(pkgJson) || !fs.existsSync(ocBin)) {
    console.log('');
    console.log('  Setting up OpenClaw workspace...');
    console.log(`  Directory: ${workspaceDir}`);
    console.log('');

    fs.mkdirSync(workspaceDir, { recursive: true });

    if (!fs.existsSync(pkgJson)) {
      execSync('npm init -y --silent', {
        cwd: workspaceDir,
        stdio: 'pipe',
        timeout: 30000,
      });
    }

    console.log('  Installing openclaw...');
    execSync('npm install openclaw@latest', {
      cwd: workspaceDir,
      stdio: 'inherit',
      timeout: 300000,
    });
  }

  // Ensure global-agent is installed so Node honors HTTP(S)_PROXY inside containment.
  // Pin to a version that ships prebuilt dist/ to avoid runtime require errors.
  const globalAgentDir = path.join(workspaceDir, 'node_modules', 'global-agent');
  const globalAgentDist = path.join(globalAgentDir, 'dist');
  if (!fs.existsSync(globalAgentDir) || !fs.existsSync(globalAgentDist)) {
    console.log('  Installing global-agent@2.2.0 (proxy support)...');
    execSync('npm install global-agent@2.2.0', {
      cwd: workspaceDir,
      stdio: 'inherit',
      timeout: 300000,
    });
  }

  // Copy OpenClaw config into workspace (container HOME=/workspace)
  // Ensure gateway.auth has a valid token — OpenClaw requires one.
  // Also forward env keys from the OpenClaw config into the container.
  const ocConfigDest = path.join(workspaceDir, '.openclaw');
  fs.mkdirSync(ocConfigDest, { recursive: true });
  const forwardEnvKeys: string[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(ocConfigSrc, 'utf-8'));
    if (!raw.gateway) raw.gateway = {};
    raw.gateway.auth = {
      mode: 'token',
      token: crypto.randomBytes(32).toString('hex'),
    };
    if (raw.env && typeof raw.env === 'object') {
      for (const [key, value] of Object.entries(raw.env as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 0) {
          process.env[key] = value;
          forwardEnvKeys.push(key);
        }
      }
    }
    fs.writeFileSync(
      path.join(ocConfigDest, 'openclaw.json'),
      JSON.stringify(raw, null, 2) + '\n',
      'utf-8',
    );
  } catch {
    // Fallback: straight copy
    fs.copyFileSync(ocConfigSrc, path.join(ocConfigDest, 'openclaw.json'));
  }

  // Create a proxy bootstrap for undici/fetch inside the container.
  // Node's global fetch does not honor HTTP(S)_PROXY by default.
  const proxyBootstrapPath = path.join(ocConfigDest, 'acp-proxy-bootstrap.cjs');
  const proxyBootstrap = [
    "try {",
    "  const { ProxyAgent, setGlobalDispatcher } = require('undici');",
    "  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;",
    "  if (proxy) {",
    "    setGlobalDispatcher(new ProxyAgent(proxy));",
    "  }",
    "} catch (err) {",
    "  // Best effort: if undici isn't available, ignore.",
    "}",
    "",
  ].join('\n');
  fs.writeFileSync(proxyBootstrapPath, proxyBootstrap, 'utf-8');

  // Resolve the openclaw.yml policy template relative to this package
  // dist/cli/start.js -> dist/cli -> dist -> cli -> repo root
  const policyPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..', '..', '..', 'templates', 'openclaw.yml'
  );

  if (!fs.existsSync(policyPath)) {
    console.error(`  Policy template not found: ${policyPath}`);
    console.error('  Make sure ACP is installed correctly.');
    process.exit(1);
  }

  // Delegate to containCommand with the right options
  const containOpts: ContainOptions = {
    image: 'node:22-slim',
    workspace: workspaceDir,
    policy: policyPath,
    interactive: false,
    writable: true,
    env: ['NODE_OPTIONS', ...forwardEnvKeys],
    consentPort: '8443',
    httpProxyPort: '8444',
    config: options.config,
  };

  const command = ['node', 'node_modules/.bin/openclaw', 'gateway'];

  // Force Node to load global-agent so HTTP(S) respects the proxy in containment.
  const existingNodeOptions = process.env.NODE_OPTIONS || '';
  const requires = [
    'global-agent/bootstrap',
    '/workspace/.openclaw/acp-proxy-bootstrap.cjs',
  ];
  const missing = requires.filter(r => !existingNodeOptions.includes(r));
  if (missing.length > 0) {
    const prefix = existingNodeOptions ? `${existingNodeOptions} ` : '';
    process.env.NODE_OPTIONS = `${prefix}${missing.map(r => `--require ${r}`).join(' ')}`;
  }

  await containCommand(command, containOpts);
}
