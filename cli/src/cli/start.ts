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

  // Run openclaw doctor --fix to finalize config (enables Telegram plugin, etc.)
  try {
    console.log('  Running openclaw doctor --fix...');
    execSync(`node ${ocBin} doctor --fix`, {
      cwd: workspaceDir,
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch {
    // Non-fatal — doctor may fail if gateway isn't running yet
  }

  // Copy OpenClaw config into workspace (container HOME=/workspace)
  // Strip gateway.auth before copying — doctor --fix may add auth modes
  // that the containerised gateway version doesn't recognise.
  const ocConfigDest = path.join(workspaceDir, '.openclaw');
  fs.mkdirSync(ocConfigDest, { recursive: true });
  try {
    const raw = JSON.parse(fs.readFileSync(ocConfigSrc, 'utf-8'));
    if (raw.gateway?.auth) delete raw.gateway.auth;
    fs.writeFileSync(
      path.join(ocConfigDest, 'openclaw.json'),
      JSON.stringify(raw, null, 2) + '\n',
      'utf-8',
    );
  } catch {
    // Fallback: straight copy
    fs.copyFileSync(ocConfigSrc, path.join(ocConfigDest, 'openclaw.json'));
  }

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
    env: [],
    consentPort: '8443',
    httpProxyPort: '8444',
    config: options.config,
  };

  const command = ['node', 'node_modules/.bin/openclaw', 'gateway'];

  await containCommand(command, containOpts);
}
