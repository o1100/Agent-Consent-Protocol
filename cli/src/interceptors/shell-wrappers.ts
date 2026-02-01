/**
 * Shell Command Interception — PATH Wrapper Generation
 *
 * Generates thin wrapper scripts in a temp directory that intercept
 * shell commands (curl, rm, git, etc.) and route them through
 * ACP's /acp/intercept endpoint before executing the real binary.
 *
 * Also generates acp-gate.mjs — a small Node.js helper that POSTs
 * to /acp/intercept. Shell wrappers call this instead of curl to
 * avoid a circular dependency (wrapping curl with a script that calls curl).
 *
 * Fail-closed: if ACP is unreachable, the command is denied.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export const DEFAULT_WRAPPED_COMMANDS = [
  // Network
  'curl', 'wget', 'ssh', 'scp', 'nc',
  // Execution
  'python', 'python3', 'node', 'bash', 'sh',
  // Destructive
  'rm', 'rmdir', 'mv', 'chmod',
  // Package managers
  'pip', 'pip3', 'npm', 'npx', 'brew',
  // DevOps
  'git', 'docker', 'kubectl',
];

interface WrapperConfig {
  acpPort: number;
  commands?: string[];
  failMode?: 'deny' | 'allow';
}

let wrapperDir: string | null = null;

/**
 * Generate shell wrapper scripts + acp-gate.mjs helper.
 * Returns the path to the wrapper bin directory (prepend to PATH).
 */
export function generateWrappers(config: WrapperConfig): string {
  const commands = config.commands || DEFAULT_WRAPPED_COMMANDS;
  const failMode = config.failMode || 'deny';

  // Create temp directory for wrappers
  wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-wrappers-'));
  const binDir = path.join(wrapperDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  // Resolve the real node binary path once, so wrappers don't recurse
  // through the wrapper bin dir when invoking node.
  let realNodePath = 'node'; // fallback
  try {
    const nodePaths = execSync('which -a node 2>/dev/null || true', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(p => p && !p.startsWith(binDir));
    if (nodePaths.length > 0) {
      realNodePath = nodePaths[0];
    }
  } catch {
    // keep fallback
  }

  // Generate acp-gate.mjs helper
  generateGateHelper(binDir, config.acpPort, failMode, realNodePath);

  // Generate wrapper for each command
  for (const cmd of commands) {
    generateWrapper(binDir, cmd, config.acpPort, failMode, realNodePath);
  }

  return binDir;
}

/**
 * Generate the acp-gate.mjs Node.js helper script.
 * This is called by shell wrappers to POST to /acp/intercept.
 */
function generateGateHelper(binDir: string, acpPort: number, failMode: string, realNodePath: string): void {
  const script = `#!${realNodePath}
// ACP Gate Helper — POSTs to /acp/intercept and returns the decision.
// Usage: node acp-gate.mjs <tool> <json-args>
// Exit codes: 0 = allowed, 1 = denied, 2 = error

import http from 'node:http';

const tool = process.argv[2];
const argsJson = process.argv[3] || '{}';
const acpPort = ${acpPort};
const failMode = '${failMode}';

if (!tool) {
  console.error('acp-gate: missing tool argument');
  process.exit(failMode === 'deny' ? 1 : 0);
}

let args;
try {
  args = JSON.parse(argsJson);
} catch {
  args = { command: argsJson };
}

const payload = JSON.stringify({
  kind: 'shell',
  tool: tool,
  arguments: args,
});

const req = http.request({
  hostname: '127.0.0.1',
  port: acpPort,
  path: '/acp/intercept',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
  timeout: 30000,
}, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      if (result.allowed) {
        process.exit(0);
      } else {
        const reason = result.reason || 'Denied by ACP';
        console.error(\`acp: denied — \${reason}\`);
        process.exit(1);
      }
    } catch {
      console.error('acp-gate: invalid response from ACP');
      process.exit(failMode === 'deny' ? 1 : 0);
    }
  });
});

req.on('error', () => {
  console.error('acp-gate: could not reach ACP proxy');
  process.exit(failMode === 'deny' ? 1 : 0);
});

req.on('timeout', () => {
  req.destroy();
  console.error('acp-gate: timeout waiting for ACP proxy');
  process.exit(failMode === 'deny' ? 1 : 0);
});

req.write(payload);
req.end();
`;

  const helperPath = path.join(binDir, 'acp-gate.mjs');
  fs.writeFileSync(helperPath, script, { mode: 0o755 });
}

/**
 * Generate a wrapper script for a single command.
 * The wrapper:
 * 1. Resolves the original binary location (skipping this wrapper dir)
 * 2. Calls acp-gate.mjs with the tool name and arguments
 * 3. If allowed: execs the original binary with original args
 * 4. If denied: exits with code 126
 */
function generateWrapper(binDir: string, cmd: string, acpPort: number, failMode: string, realNodePath: string): void {
  // Find the real binary path (outside our wrapper dir)
  let realPath: string;
  try {
    // Use 'which -a' to find all instances, then pick the first one
    // that isn't in our wrapper directory
    const allPaths = execSync(`which -a ${cmd} 2>/dev/null || true`, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(p => p && !p.startsWith(binDir));

    if (allPaths.length === 0) {
      // Command not found on system — skip wrapper generation
      return;
    }
    realPath = allPaths[0];
  } catch {
    return;
  }

  const script = `#!/bin/bash
# ACP wrapper for: ${cmd}
# Real binary: ${realPath}
set -euo pipefail

# Recursion guard: if we're already inside a wrapper, exec the real binary directly
if [ -n "\${ACP_WRAPPER_ACTIVE:-}" ]; then
  exec "${realPath}" "$@"
fi
export ACP_WRAPPER_ACTIVE=1

ACP_GATE_DIR="$(dirname "$0")"
REAL_CMD="${realPath}"

# Build the full command string for context
FULL_CMD="${cmd} $*"

# Ask ACP for permission
ARGS_JSON=$(printf '%s' "$FULL_CMD" | ${realNodePath} -e "
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>console.log(JSON.stringify({command:d,args:process.argv.slice(1)})))
" -- "$@" 2>/dev/null || echo '{"command":"${cmd}"}')

if ${realNodePath} "$ACP_GATE_DIR/acp-gate.mjs" "shell:${cmd}" "$ARGS_JSON"; then
  unset ACP_WRAPPER_ACTIVE
  exec "$REAL_CMD" "$@"
else
  exit 126
fi
`;

  const wrapperPath = path.join(binDir, cmd);
  fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

/**
 * Clean up wrapper scripts directory.
 */
export function cleanupWrappers(): void {
  if (wrapperDir) {
    try {
      fs.rmSync(wrapperDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
    wrapperDir = null;
  }
}

/**
 * Get the current wrapper directory path (if generated).
 */
export function getWrapperDir(): string | null {
  return wrapperDir;
}
