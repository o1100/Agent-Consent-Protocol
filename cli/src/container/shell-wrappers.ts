/**
 * Shell Wrappers — Generate wrapper scripts for Layer 1 interception
 *
 * Generates thin bash scripts that intercept shell commands inside the
 * container. Each wrapper:
 *   1. POSTs to the consent server (host:8443/consent)
 *   2. If approved: execs the real binary
 *   3. If denied: exits with code 126
 *
 * Also generates acp-gate.mjs — a Node.js helper that handles the
 * HTTP POST to avoid circular dependencies (can't use curl wrapper
 * to ask permission for curl).
 *
 * The wrapper list comes from the policy's `wrap` section.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

interface WrapperConfig {
  consentPort: number;
  consentHost: string;
  commands: string[];
  failMode?: 'deny' | 'allow';
}

let wrapperDir: string | null = null;

/**
 * Generate shell wrapper scripts + acp-gate.mjs helper.
 * Returns the path to the wrapper bin directory (prepend to PATH).
 */
export function generateWrappers(config: WrapperConfig): string {
  const { commands, failMode = 'deny' } = config;

  wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-wrappers-'));
  const binDir = path.join(wrapperDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  // Resolve the real node binary path so wrappers don't recurse
  let realNodePath = 'node';
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

  // Generate the gate helper
  generateGateHelper(binDir, config, failMode, realNodePath);

  // Generate a wrapper for each command
  for (const cmd of commands) {
    generateWrapper(binDir, cmd, config, failMode, realNodePath);
  }

  return binDir;
}

/**
 * Generate the acp-gate.mjs Node.js helper.
 * Called by shell wrappers to POST to /consent.
 */
function generateGateHelper(
  binDir: string,
  config: WrapperConfig,
  failMode: string,
  realNodePath: string
): void {
  const script = `#!${realNodePath}
// ACP Gate Helper — POSTs to /consent and returns the decision.
// Usage: node acp-gate.mjs <command-name> <full-command-string>
// Exit codes: 0 = allowed, 1 = denied, 2 = error

import http from 'node:http';

const name = process.argv[2];
const args = process.argv[3] || '';
const consentHost = '${config.consentHost}';
const consentPort = ${config.consentPort};
const failMode = '${failMode}';

if (!name) {
  console.error('acp-gate: missing command name');
  process.exit(failMode === 'deny' ? 1 : 0);
}

const payload = JSON.stringify({ name, args });

const req = http.request({
  hostname: consentHost,
  port: consentPort,
  path: '/consent',
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
      if (result.approved) {
        process.exit(0);
      } else {
        const reason = result.reason || 'Denied by ACP';
        console.error(\`acp: denied — \${reason}\`);
        process.exit(1);
      }
    } catch {
      console.error('acp-gate: invalid response from consent server');
      process.exit(failMode === 'deny' ? 1 : 0);
    }
  });
});

req.on('error', () => {
  console.error('acp-gate: could not reach consent server');
  process.exit(failMode === 'deny' ? 1 : 0);
});

req.on('timeout', () => {
  req.destroy();
  console.error('acp-gate: timeout waiting for consent server');
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
 */
function generateWrapper(
  binDir: string,
  cmd: string,
  config: WrapperConfig,
  failMode: string,
  realNodePath: string
): void {
  // Find the real binary path (outside our wrapper dir)
  let realPath: string;
  try {
    const allPaths = execSync(`which -a ${cmd} 2>/dev/null || true`, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(p => p && !p.startsWith(binDir));

    if (allPaths.length === 0) {
      // Command not found on system — skip
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

# Recursion guard
if [ -n "\${ACP_WRAPPER_ACTIVE:-}" ]; then
  exec "${realPath}" "$@"
fi
export ACP_WRAPPER_ACTIVE=1

ACP_GATE_DIR="$(dirname "$0")"
REAL_CMD="${realPath}"
FULL_CMD="${cmd} $*"

# Ask consent server for permission
if ${realNodePath} "$ACP_GATE_DIR/acp-gate.mjs" "${cmd}" "$FULL_CMD"; then
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
 * Get the current wrapper directory path.
 */
export function getWrapperDir(): string | null {
  return wrapperDir;
}
