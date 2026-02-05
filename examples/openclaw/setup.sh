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

echo ""
echo "  Workspace ready at $WORKSPACE_DIR"
echo ""
echo "  Next steps:"
echo "    1. Copy your .openclaw/ config into $WORKSPACE_DIR/.openclaw/"
echo "       cp -r ~/.openclaw $WORKSPACE_DIR/.openclaw"
echo ""
echo "    2. Make sure workspace path in config.yml is set to /workspace"
echo ""
echo "    3. Run:"
echo "       acp contain --workspace=$WORKSPACE_DIR --env=ANTHROPIC_API_KEY \\"
echo "         -- node /workspace/node_modules/openclaw/openclaw.mjs gateway"
echo ""
