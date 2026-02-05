#!/bin/bash
# Manual OpenClaw workspace setup — alternative to `acp start openclaw`
#
# Prefer using `acp start openclaw` which handles this automatically.
# This script is for manual/custom setups only.
#
# Usage: ./setup.sh [workspace-dir]

set -e

WORKSPACE_DIR="${1:-./openclaw-workspace}"

echo ""
echo "  ACP — OpenClaw Workspace Setup"
echo "  ───────────────────────────────"
echo ""
echo "  Note: prefer 'acp start openclaw' which does this automatically."
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
echo "  To run OpenClaw through ACP (recommended):"
echo "    acp start openclaw --workspace=$WORKSPACE_DIR"
echo ""
echo "  Or manually with acp contain:"
echo "    acp contain --writable --workspace=$WORKSPACE_DIR \\"
echo "      --policy=templates/openclaw.yml \\"
echo "      -- node node_modules/.bin/openclaw gateway"
echo ""
