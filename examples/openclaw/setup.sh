#!/bin/bash
# Manual OpenClaw workspace setup helper for ACP v0.3.0 VM mode.
#
# Prefer: sudo acp start openclaw --openclaw-user=openclaw
# This script is only for custom/manual workspace preparation.

set -euo pipefail

WORKSPACE_DIR="${1:-./openclaw-workspace}"

echo ""
echo "  ACP v0.3.0 — OpenClaw Workspace Setup"
echo "  ──────────────────────────────────────"
echo ""
echo "  Preferred path: sudo acp start openclaw --openclaw-user=openclaw"
echo ""

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

if [ ! -f package.json ]; then
  npm init -y --silent
fi

echo "  Installing openclaw..."
npm install openclaw@latest

if [ -d "$HOME/.openclaw" ] && [ -f "$HOME/.openclaw/openclaw.json" ]; then
  mkdir -p .openclaw
  cp "$HOME/.openclaw/openclaw.json" .openclaw/openclaw.json
  echo "  Copied ~/.openclaw/openclaw.json into workspace"
else
  echo "  No ~/.openclaw/openclaw.json found."
  echo "  Run 'acp init --channel=telegram' as the runtime user first."
fi

echo ""
echo "  Workspace ready at $WORKSPACE_DIR"
echo ""
echo "  Start with ACP VM mode:"
echo "    sudo acp start openclaw --openclaw-user=openclaw --workspace=$WORKSPACE_DIR"
echo ""
echo "  Legacy Docker compatibility path:"
echo "    acp contain --writable --workspace=$WORKSPACE_DIR -- node node_modules/.bin/openclaw gateway"
echo ""
