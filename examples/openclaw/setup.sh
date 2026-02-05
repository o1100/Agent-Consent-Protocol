#!/bin/bash
# Sets up an OpenClaw workspace for use with ACP
# Usage: ./setup.sh [workspace-dir]

set -e

WORKSPACE_DIR="${1:-./openclaw-workspace}"

echo ""
echo "  ACP — OpenClaw Workspace Setup"
echo "  ───────────────────────────────"
echo ""

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

# Install openclaw in workspace so it's available inside the container
if [ ! -f package.json ]; then
  npm init -y --silent
fi

echo "  Installing openclaw..."
npm install openclaw@latest

# Copy OpenClaw config into workspace if it exists on host
if [ -d "$HOME/.openclaw" ] && [ -f "$HOME/.openclaw/openclaw.json" ]; then
  mkdir -p .openclaw
  cp "$HOME/.openclaw/openclaw.json" .openclaw/openclaw.json
  echo "  Copied ~/.openclaw/openclaw.json into workspace"
else
  echo "  No ~/.openclaw/openclaw.json found."
  echo "  Run 'acp init --channel=telegram' first to generate it."
fi

echo ""
echo "  Workspace ready at $WORKSPACE_DIR"
echo ""
echo "  To run OpenClaw through ACP:"
echo "    acp contain --workspace=$WORKSPACE_DIR --env=ANTHROPIC_API_KEY \\"
echo "      -- node /workspace/node_modules/.bin/openclaw gateway"
echo ""
echo "  To start the messaging bot outside ACP:"
echo "    openclaw gateway"
echo ""
