#!/usr/bin/env bash
set -euo pipefail

# ── ACP + OpenClaw Full VM Setup ─────────────────────────────────────────────
# Target: Ubuntu 22.04 / 24.04 (Debian-compatible)
# Usage:  curl -fsSL https://raw.githubusercontent.com/o1100/Agent-Consent-Protocol/v0.3.0/install.sh | bash
#     or: ./install.sh  (from inside the cloned repo)
# ─────────────────────────────────────────────────────────────────────────────

banner() { printf '\n\033[1;36m── %s ──\033[0m\n' "$1"; }
ok()     { printf '   \033[32m✓ %s\033[0m\n' "$1"; }
skip()   { printf '   \033[33m⏭ %s (already done)\033[0m\n' "$1"; }

REPO_URL="https://github.com/o1100/Agent-Consent-Protocol.git"
REPO_TAG="v0.3.0"
INSTALL_DIR="$HOME/Agent-Consent-Protocol"

# ── 1. Node.js 22 ────────────────────────────────────────────────────────────
banner "Step 1/5: Node.js 22"

if command -v node &>/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] < 22)' 2>/dev/null; then
    skip "Node.js $(node --version) already installed"
else
    echo "   Installing Node.js 22 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ok "Node.js $(node --version) installed"
fi

# ── 2. Docker ─────────────────────────────────────────────────────────────────
banner "Step 2/5: Docker"

if command -v docker &>/dev/null; then
    skip "Docker already installed"
else
    echo "   Installing Docker..."
    sudo apt-get update -y
    sudo apt-get install -y docker.io
    sudo systemctl enable --now docker
    ok "Docker installed"
fi

# Add current user to docker group if not already a member
if id -nG "$USER" | grep -qw docker; then
    skip "User $USER already in docker group"
else
    echo "   Adding $USER to docker group..."
    sudo usermod -aG docker "$USER"
    ok "Added $USER to docker group (using sg docker for this session)"
fi

# Helper: run a command with docker group privileges.
# If we're already in the docker group, run directly; otherwise use sg.
docker_run() {
    if id -nG "$USER" | grep -qw docker || [ "$(id -u)" = "0" ]; then
        "$@"
    else
        sg docker -c "$(printf '%q ' "$@")"
    fi
}

# Verify docker works
if docker_run docker info &>/dev/null; then
    ok "Docker is accessible"
else
    echo "   ERROR: Cannot connect to Docker. You may need to log out and back in"
    echo "   for group changes to take effect, then re-run this script."
    exit 1
fi

# ── 3. Swap (if RAM < 2GB) ───────────────────────────────────────────────────
banner "Step 3/5: Swap"

RAM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
SWAP_KB=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)

if [ "$RAM_KB" -eq 0 ]; then
    skip "Cannot read /proc/meminfo (not Linux?); skipping swap setup"
elif [ "$RAM_KB" -ge 2097152 ]; then
    skip "RAM is $(( RAM_KB / 1024 ))MB — swap not needed"
elif [ "$SWAP_KB" -ge 1048576 ]; then
    skip "Swap is already $(( SWAP_KB / 1024 ))MB"
else
    echo "   RAM is $(( RAM_KB / 1024 ))MB — creating 2GB swapfile..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    # Persist across reboots
    if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    fi
    ok "2GB swap enabled"
fi

# ── 4. Clone & build ACP ─────────────────────────────────────────────────────
banner "Step 4/5: Clone & build ACP"

# Detect if we're already inside the repo
if [ -f "cli/package.json" ]; then
    REPO_DIR="$(pwd)"
    skip "Already inside ACP repo at $REPO_DIR"
elif [ -f "$INSTALL_DIR/cli/package.json" ]; then
    REPO_DIR="$INSTALL_DIR"
    skip "ACP repo already cloned at $REPO_DIR"
else
    echo "   Cloning ACP $REPO_TAG..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    REPO_DIR="$INSTALL_DIR"
    ok "Cloned to $REPO_DIR"
fi

# Always prefer the tag explicitly (avoid ambiguity with same-named branches)
(
  cd "$REPO_DIR"
  git fetch --tags --force >/dev/null 2>&1 || true
  git checkout -f "tags/$REPO_TAG" >/dev/null 2>&1 || true
)

# Build & link
if command -v acp &>/dev/null && [ "$(acp --version 2>/dev/null)" = "0.3.0" ]; then
    skip "acp 0.3.0 already built and linked"
else
    echo "   Building ACP CLI..."
    (cd "$REPO_DIR/cli" && npm install && npm run build)
    (cd "$REPO_DIR/cli" && sudo npm link)
    ok "acp $(acp --version) installed globally"
fi

# ── 5. Configure & start ─────────────────────────────────────────────────────
banner "Step 5/5: Configure ACP + start OpenClaw"

echo ""
echo "   This step runs two interactive commands:"
echo "   1) acp init --channel=telegram"
echo "      → Configures your consent bot token, chat ID,"
echo "        and optionally the OpenClaw messaging bot."
echo "   2) acp start openclaw"
echo "      → Creates workspace, installs OpenClaw, starts gateway in Docker."
echo ""

# acp init (interactive — needs user input)
if [ -f "$HOME/.acp/config.yml" ]; then
    skip "ACP already configured (~/.acp/config.yml exists)"
    echo "   Run 'acp init --channel=telegram' again to reconfigure."
else
    if [ -t 0 ]; then
        acp init --channel=telegram </dev/tty
    else
        acp init --channel=telegram
    fi
    ok "ACP configured"
fi

echo ""

# acp start openclaw — run once to set up workspace, then install as systemd service
if [ -f "$HOME/.openclaw/openclaw.json" ]; then
    echo "   Creating systemd user service for persistence..."
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/acp-openclaw.service" <<'UNIT'
[Unit]
Description=ACP OpenClaw Gateway
After=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/acp start openclaw
Restart=on-failure
RestartSec=10
Environment=HOME=%h

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable --now acp-openclaw.service
    # Allow user services to run after logout
    sudo loginctl enable-linger "$USER" 2>/dev/null || true
    ok "OpenClaw gateway running as systemd service"
    echo "   Service: systemctl --user status acp-openclaw"
    echo "   Logs:    journalctl --user -u acp-openclaw -f"
else
    echo "   Skipping 'acp start openclaw' — no OpenClaw config found."
    echo "   If you configured the OpenClaw messaging bot during 'acp init',"
    echo "   run 'acp start openclaw' manually."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
banner "Setup complete"
echo ""
echo "   Quick reference:"
echo "   acp init --channel=telegram    Re-run setup wizard"
echo "   systemctl --user restart acp-openclaw   Restart gateway"
echo "   journalctl --user -u acp-openclaw -f    View logs"
echo "   acp contain -- python agent.py          Run any agent through ACP"
echo "   cat ~/.acp/audit.jsonl                  View audit log"
echo ""
