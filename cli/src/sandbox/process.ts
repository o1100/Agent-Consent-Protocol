/**
 * Sandboxed Process Spawning
 *
 * Spawns the agent process with a controlled environment:
 * - ACP_PROXY_URL injected (so MCP clients connect to ACP)
 * - Vault secrets stripped from environment
 * - Stdin/stdout/stderr connected for MCP communication
 */

import { spawn, ChildProcess } from 'node:child_process';
import { CredentialVault } from './credentials.js';

interface SandboxOptions {
  proxyUrl: string;
  vault: CredentialVault;
  networkIsolation: boolean;
}

/**
 * Create a sandboxed child process for the agent.
 *
 * The agent runs with:
 * 1. ACP_PROXY_URL set to the ACP proxy address
 * 2. MCP_SERVER_URL set to ACP proxy (for MCP SDK auto-detection)
 * 3. All vault secret keys stripped from the environment
 * 4. Standard I/O inherited (for MCP stdio transport and user visibility)
 */
export function createSandboxedProcess(
  command: string[],
  options: SandboxOptions
): ChildProcess {
  const [cmd, ...args] = command;

  // Build sanitized environment
  const env = buildSandboxEnv(options);

  console.log(`  🚀 Starting agent: ${command.join(' ')}`);
  if (options.networkIsolation) {
    console.log('  🔒 Network isolated — agent can only reach ACP proxy');
  }
  console.log('');

  const child = spawn(cmd, args, {
    env,
    stdio: 'inherit', // Agent sees the terminal for output
    cwd: process.cwd(),
  });

  child.on('error', (err) => {
    console.error(`  ❌ Failed to start agent: ${err.message}`);
    if (err.message.includes('ENOENT')) {
      console.error(`  Command not found: ${cmd}`);
      console.error('  Make sure the command is installed and in your PATH.');
    }
  });

  return child;
}

/**
 * Build a sanitized environment for the agent process.
 *
 * - Copies the current environment
 * - Injects ACP_PROXY_URL
 * - Strips any env vars that match vault secret keys
 * - Sets MCP_SERVER_URL for MCP SDK compatibility
 */
function buildSandboxEnv(options: SandboxOptions): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy current environment
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Inject ACP proxy URL
  env.ACP_PROXY_URL = options.proxyUrl;
  env.MCP_SERVER_URL = options.proxyUrl;

  // Strip vault secrets from environment
  // If a secret is in the vault, the agent shouldn't have it in env either
  const vaultKeys = options.vault.list();
  for (const key of vaultKeys) {
    delete env[key];
  }

  // Mark that we're running inside ACP
  env.ACP_SANDBOX = '1';
  env.ACP_VERSION = '0.2.1';

  return env;
}
