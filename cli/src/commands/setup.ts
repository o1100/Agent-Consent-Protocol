/**
 * acp setup — Integration setup commands
 *
 * acp setup claude-code  — Generate Claude Code hook + instructions
 * acp setup openclaw     — Print instructions for OpenClaw integration
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { generateClaudeCodeHook, getClaudeCodeSettings } from '../integrations/claude-code.js';

const ACP_DIR = path.join(os.homedir(), '.acp');
const HOOKS_DIR = path.join(ACP_DIR, 'hooks');

export async function setupCommand(integration: string, options: { port?: string }): Promise<void> {
  switch (integration) {
    case 'claude-code':
      setupClaudeCode(options);
      break;
    case 'claude-code-contained':
      await setupClaudeCodeContained();
      break;
    case 'openclaw':
      setupOpenClaw();
      break;
    default:
      console.error(`  ❌ Unknown integration: "${integration}"`);
      console.error('  Available: claude-code, claude-code-contained, openclaw');
      process.exit(1);
  }
}

function setupClaudeCode(options: { port?: string }): void {
  const port = parseInt(options.port || '8443', 10);

  console.log('');
  console.log('  🔐 ACP — Claude Code Integration Setup');
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Generate the hook script
  const hookPath = generateClaudeCodeHook(port, HOOKS_DIR);
  console.log(`  ✅ Hook script generated: ${hookPath}`);
  console.log('');

  // Show the settings to add
  const settings = getClaudeCodeSettings(hookPath);
  const settingsJson = JSON.stringify(settings, null, 2)
    .split('\n')
    .map(line => '    ' + line)
    .join('\n');

  console.log('  Add this to ~/.claude/settings.json:');
  console.log('');
  console.log(settingsJson);
  console.log('');
  console.log('  Then start ACP in another terminal:');
  console.log(`    acp run --port ${port} -- echo "ACP ready"`);
  console.log('');
  console.log('  Or run Claude Code through ACP:');
  console.log(`    acp run --port ${port} -- claude`);
  console.log('');

  // Try to auto-configure if settings.json exists
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (fs.existsSync(claudeSettingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
      if (!existing.hooks?.PreToolUse) {
        existing.hooks = existing.hooks || {};
        existing.hooks.PreToolUse = settings.hooks && (settings.hooks as Record<string, unknown>).PreToolUse;
        fs.writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2));
        console.log(`  ✅ Auto-configured ${claudeSettingsPath}`);
      } else {
        console.log(`  ⚠️  ${claudeSettingsPath} already has PreToolUse hooks.`);
        console.log('  Please merge manually.');
      }
    } catch {
      console.log(`  ⚠️  Could not auto-configure ${claudeSettingsPath}`);
      console.log('  Please add the settings manually.');
    }
  }

  console.log('');
}

const CLAUDE_CODE_DOCKERFILE = `FROM node:20-slim

# Install common tools (container is read-only, can't install at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl wget git ca-certificates \\
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /workspace
`;

async function setupClaudeCodeContained(): Promise<void> {
  console.log('');
  console.log('  🔐 ACP — Claude Code Contained Setup');
  console.log('  ─────────────────────────────────────────');
  console.log('');

  // Check Docker is available
  try {
    execSync('docker version --format "{{.Server.Version}}"', { stdio: 'pipe', timeout: 10000 });
  } catch {
    console.error('  ❌ Docker is not running. Start Docker Desktop and try again.');
    process.exit(1);
  }

  // Check if image already exists
  try {
    execSync('docker image inspect claude-code-acp', { stdio: 'pipe', timeout: 10000 });
    console.log('  ✅ Docker image claude-code-acp already exists.');
    console.log('  To rebuild, run: docker rmi claude-code-acp && acp setup claude-code-contained');
    console.log('');
  } catch {
    // Image doesn't exist, build it
    console.log('  Building Docker image: claude-code-acp');
    console.log('  This includes Node.js, Claude Code, git, curl, wget...');
    console.log('');

    // Write Dockerfile to temp location
    const tmpDockerfile = path.join(os.tmpdir(), 'acp-claude-code-dockerfile');
    fs.writeFileSync(tmpDockerfile, CLAUDE_CODE_DOCKERFILE);

    try {
      execSync(`docker build -t claude-code-acp -f ${tmpDockerfile} ${os.tmpdir()}`, {
        stdio: 'inherit',
        timeout: 600000,
      });
      console.log('');
      console.log('  ✅ Docker image built: claude-code-acp');
    } catch (err) {
      console.error(`  ❌ Failed to build image: ${(err as Error).message}`);
      process.exit(1);
    } finally {
      try { fs.unlinkSync(tmpDockerfile); } catch {}
    }
  }

  console.log('  Run Claude Code in contained mode:');
  console.log('');
  console.log('    acp run --contained --interactive --channel=telegram --image claude-code-acp -- claude');
  console.log('');
  console.log('  For non-interactive (one-shot) mode:');
  console.log('');
  console.log('    acp run --contained --image claude-code-acp -- claude --print "your prompt here"');
  console.log('');
  console.log('  Note: --interactive requires a non-terminal consent channel (e.g. Telegram).');
  console.log('  Run "acp init --channel=telegram" first if you haven\'t already.');
  console.log('');
}

function setupOpenClaw(): void {
  console.log('');
  console.log('  🔐 ACP — OpenClaw Integration Setup');
  console.log('  ─────────────────────────────────────────');
  console.log('');
  console.log('  Wrap your OpenClaw command with ACP:');
  console.log('');
  console.log('    acp run -- openclaw');
  console.log('');
  console.log('  This will:');
  console.log('    • Intercept shell commands via PATH wrappers');
  console.log('    • Intercept HTTP requests via HTTP proxy');
  console.log('    • Intercept MCP tool calls via ACP proxy');
  console.log('');
  console.log('  For a custom policy, use:');
  console.log('');
  console.log('    acp run --policy policies/openclaw.yml -- openclaw');
  console.log('');
  console.log('  To disable specific interceptors:');
  console.log('');
  console.log('    acp run --no-shell-intercept --no-http-intercept -- openclaw');
  console.log('');
}
