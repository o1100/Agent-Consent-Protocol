/**
 * Shell Wrappers — Generate wrapper scripts for Layer 1 interception
 *
 * Generates thin bash scripts that intercept shell commands inside the
 * container. Each wrapper:
 *   1. POSTs to the consent server (host:8443/consent)
 *   2. If approved: execs the real binary
 *   3. If denied: exits with code 126
 *
 * Also generates acp-gate.sh — a POSIX shell helper that finds the best
 * available interpreter (python3 or node) in the container and uses it
 * to make the HTTP POST to the consent server. This removes the hard
 * dependency on Node.js being present inside the container.
 *
 * The wrapper list comes from the policy's `wrap` section.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface WrapperConfig {
  consentPort: number;
  consentHost: string;
  commands: string[];
  failMode?: 'deny' | 'allow';
}

let wrapperDir: string | null = null;

/**
 * Generate shell wrapper scripts + acp-gate.sh helper.
 * Returns the path to the wrapper bin directory (prepend to PATH).
 */
export function generateWrappers(config: WrapperConfig): string {
  const { commands, failMode = 'deny' } = config;

  wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-wrappers-'));
  const binDir = path.join(wrapperDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  // Generate the gate helper
  generateGateHelper(binDir, config, failMode);

  // Generate a wrapper for each command
  for (const cmd of commands) {
    generateWrapper(binDir, cmd, failMode);
  }

  return binDir;
}

/**
 * Generate the acp-gate.sh POSIX shell helper.
 * Called by shell wrappers to POST to /consent.
 *
 * Finds the best available interpreter in the container (python3, node)
 * by looking in the real PATH (bypassing wrapper directory) and uses it
 * to make the HTTP request. No hard dependency on any specific runtime.
 */
function generateGateHelper(
  binDir: string,
  config: WrapperConfig,
  failMode: string
): void {
  const script = `#!/bin/sh
# ACP Gate Helper — POSTs to /consent using whatever interpreter is available.
# Finds python3 or node in the container (bypassing ACP wrappers) and uses
# it to make the HTTP request. No hard dependency on a specific runtime.
# Usage: acp-gate.sh <command-name> <args-string>
# Exit codes: 0 = allowed, 1 = denied

NAME="$1"
ARGS="\${2:-}"
CONSENT_HOST="${config.consentHost}"
CONSENT_PORT=${config.consentPort}
FAIL_MODE="${failMode}"

if [ -z "$NAME" ]; then
  echo "acp-gate: missing command name" >&2
  if [ "$FAIL_MODE" = "deny" ]; then exit 1; else exit 0; fi
fi

# Strip wrapper directory from PATH to find real binaries (avoids wrapper recursion)
REAL_PATH="\${PATH#/usr/local/bin/acp-wrappers:}"

# --- Try python3 (available in python and ubuntu images) ---
REAL_PYTHON=$(PATH="$REAL_PATH" command -v python3 2>/dev/null || true)
if [ -n "$REAL_PYTHON" ]; then
  "$REAL_PYTHON" -c '
import http.client, json, sys
name, args, host, port, fail_mode = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
try:
    conn = http.client.HTTPConnection(host, port, timeout=130)
    payload = json.dumps({"name": name, "args": args})
    conn.request("POST", "/consent", payload, {"Content-Type": "application/json", "Content-Length": str(len(payload))})
    data = json.loads(conn.getresponse().read())
    if data.get("approved"):
        sys.exit(0)
    reason = data.get("reason", "Denied by ACP")
    sys.stderr.write("acp: denied -- " + reason + "\\n")
    sys.exit(1)
except Exception as e:
    sys.stderr.write("acp-gate: error -- " + str(e) + "\\n")
    sys.exit(1 if fail_mode == "deny" else 0)
' "$NAME" "$ARGS" "$CONSENT_HOST" "$CONSENT_PORT" "$FAIL_MODE"
  exit $?
fi

# --- Try node (available in node images) ---
REAL_NODE=$(PATH="$REAL_PATH" command -v node 2>/dev/null || true)
if [ -n "$REAL_NODE" ]; then
  "$REAL_NODE" -e '
const http = require("http");
const name = process.argv[1];
const args = process.argv[2] || "";
const host = process.argv[3];
const port = parseInt(process.argv[4]);
const failMode = process.argv[5];
const payload = JSON.stringify({ name, args });
const req = http.request({
  hostname: host, port: port,
  path: "/consent", method: "POST",
  headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
  timeout: 130000
}, (res) => {
  let body = "";
  res.on("data", c => body += c);
  res.on("end", () => {
    try {
      const r = JSON.parse(body);
      if (r.approved) process.exit(0);
      process.stderr.write("acp: denied -- " + (r.reason || "Denied by ACP") + "\\n");
      process.exit(1);
    } catch { process.exit(1); }
  });
});
req.on("error", () => {
  process.stderr.write("acp-gate: could not reach consent server\\n");
  process.exit(failMode === "deny" ? 1 : 0);
});
req.on("timeout", () => {
  req.destroy();
  process.stderr.write("acp-gate: timeout waiting for consent\\n");
  process.exit(failMode === "deny" ? 1 : 0);
});
req.write(payload);
req.end();
' "$NAME" "$ARGS" "$CONSENT_HOST" "$CONSENT_PORT" "$FAIL_MODE"
  exit $?
fi

# --- No interpreter found ---
echo "acp-gate: no interpreter found in container (need python3 or node)" >&2
echo "acp-gate: use --image with an image that includes python3 or node" >&2
if [ "$FAIL_MODE" = "deny" ]; then exit 1; else exit 0; fi
`;

  const helperPath = path.join(binDir, 'acp-gate.sh');
  fs.writeFileSync(helperPath, script, { mode: 0o755 });
}

/**
 * Generate a wrapper script for a single command.
 * Binary resolution happens at runtime inside the container,
 * not at generation time on the host.
 *
 * The wrapper always sends the real command name (e.g. "node") to the
 * consent server for policy matching. Display-name extraction (e.g.
 * showing "openclaw" instead of "node") is handled by the channel
 * layer when rendering the Telegram/webhook message.
 */
function generateWrapper(
  binDir: string,
  cmd: string,
  failMode: string
): void {
  const script = `#!/bin/bash
# ACP wrapper for: ${cmd}
set -euo pipefail

# Recursion guard — if already inside a wrapper, exec the real binary directly
if [ -n "\${ACP_WRAPPER_ACTIVE:-}" ]; then
  exec "$(PATH="\${PATH#/usr/local/bin/acp-wrappers:}" command -v "${cmd}")" "$@"
fi
export ACP_WRAPPER_ACTIVE=1

ACP_GATE_DIR="$(dirname "$0")"

# Build the full command string for audit/display
FULL_CMD="$*"

# Find real binary for this command (skip wrapper directory)
REAL_CMD=$(PATH="\${PATH#/usr/local/bin/acp-wrappers:}" command -v "${cmd}" 2>/dev/null || true)
if [ -z "$REAL_CMD" ]; then
  echo "acp: ${cmd} not found in container" >&2
  exit 127
fi

# Ask consent server for permission (uses real command name for policy matching)
if "$ACP_GATE_DIR/acp-gate.sh" "${cmd}" "$FULL_CMD"; then
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
