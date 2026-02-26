#!/usr/bin/env bash
set -Eeuo pipefail

banner() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
ok()     { printf '   \033[32m[ok]\033[0m %s\n' "$1"; }
warn()   { printf '   \033[33m[warn]\033[0m %s\n' "$1"; }
skip()   { printf '   \033[33m[skip]\033[0m %s\n' "$1"; }
die()    { printf '   \033[31m[err]\033[0m %s\n' "$1"; exit 1; }

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options]

Installs ACP v0.3.0 for Linux VM OpenClaw mode.

Options:
  --install-dir <dir>        Repo install path (default: ~/Agent-Consent-Protocol)
  --openclaw-user <user>     Runtime user for OpenClaw (default: openclaw)
  --skip-init                Skip interactive `acp init` step
  --with-service             Install root systemd service (acp-openclaw.service)
  -h, --help                 Show help
USAGE
}

REPO_URL="https://github.com/o1100/Agent-Consent-Protocol.git"
REPO_TAG="v0.3.0"
REPO_VERSION="${REPO_TAG#v}"
INSTALL_DIR="$HOME/Agent-Consent-Protocol"
OPENCLAW_USER="openclaw"
SKIP_INIT=0
WITH_SERVICE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir)
      [[ $# -ge 2 ]] || die "Missing value for --install-dir"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --openclaw-user)
      [[ $# -ge 2 ]] || die "Missing value for --openclaw-user"
      OPENCLAW_USER="$2"
      shift 2
      ;;
    --skip-init)
      SKIP_INIT=1
      shift
      ;;
    --with-service)
      WITH_SERVICE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

SUDO="sudo"
if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
elif ! command -v sudo >/dev/null 2>&1; then
  die "sudo is required for non-root installs."
fi

run_privileged() {
  if [[ -n "$SUDO" ]]; then
    ${SUDO} "$@"
  else
    "$@"
  fi
}

run_as_user() {
  local user="$1"
  shift
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$user" -H "$@"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "$user" -- "$@"
  else
    su -s /bin/bash "$user" -c "$(printf '%q ' "$@")"
  fi
}

retry() {
  local attempts="$1"
  local delay_s="$2"
  shift 2
  local n=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [[ "$n" -ge "$attempts" ]]; then
      return 1
    fi
    warn "Command failed (attempt ${n}/${attempts}). Retrying in ${delay_s}s: $*"
    sleep "$delay_s"
    n=$((n + 1))
    delay_s=$((delay_s * 2))
  done
}

apt_install() {
  retry 3 2 run_privileged env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

banner "Step 1/5: Preflight"
command -v apt-get >/dev/null 2>&1 || die "This installer supports Ubuntu/Debian (apt-get required)."
command -v curl >/dev/null 2>&1 || die "Missing required command: curl"
command -v git >/dev/null 2>&1 || die "Missing required command: git"
ok "Preflight checks passed"

banner "Step 2/5: Node.js 22"
if command -v node >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0] < 22)' 2>/dev/null; then
  skip "Node.js $(node --version) already installed"
else
  echo "   Installing Node.js 22 via NodeSource..."
  retry 3 2 bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh'
  run_privileged bash /tmp/nodesource_setup.sh
  apt_install nodejs
  ok "Node.js $(node --version) installed"
fi

banner "Step 3/5: Linux VM prerequisites"
retry 3 2 run_privileged apt-get update -y
apt_install nftables build-essential ca-certificates
ok "Installed nftables + build prerequisites"
warn "Docker is not required for v0.3.0 VM mode."
warn "Install Docker only if you plan to use legacy 'acp contain'."

banner "Step 4/5: Build and install ACP CLI"
if [[ -f "cli/package.json" ]]; then
  REPO_DIR="$(pwd)"
  skip "Using current repo: ${REPO_DIR}"
elif [[ -f "${INSTALL_DIR}/cli/package.json" ]]; then
  REPO_DIR="${INSTALL_DIR}"
  skip "Using existing clone: ${REPO_DIR}"
else
  echo "   Cloning ACP ${REPO_TAG}..."
  retry 3 2 git clone --branch "${REPO_TAG}" --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  REPO_DIR="${INSTALL_DIR}"
  ok "Cloned to ${REPO_DIR}"
fi

if command -v acp >/dev/null 2>&1 && [[ "$(acp --version 2>/dev/null || true)" == "${REPO_VERSION}" ]]; then
  skip "acp ${REPO_VERSION} already installed"
else
  if [[ -f "${REPO_DIR}/cli/package-lock.json" ]]; then
    (cd "${REPO_DIR}/cli" && retry 3 2 npm ci --no-audit --no-fund)
  else
    (cd "${REPO_DIR}/cli" && retry 3 2 npm install --no-audit --no-fund)
  fi
  (cd "${REPO_DIR}/cli" && npm run build)
  if (cd "${REPO_DIR}/cli" && npm link >/dev/null 2>&1); then
    :
  else
    (cd "${REPO_DIR}/cli" && run_privileged npm link)
  fi
  hash -r
  [[ "$(acp --version 2>/dev/null || true)" == "${REPO_VERSION}" ]] || die "acp installed, but version check failed."
  ok "Installed acp ${REPO_VERSION}"
fi

banner "Step 5/5: Configure OpenClaw VM mode"
if id -u "${OPENCLAW_USER}" >/dev/null 2>&1; then
  skip "User ${OPENCLAW_USER} already exists"
else
  echo "   Creating user ${OPENCLAW_USER}..."
  run_privileged useradd -m -s /bin/bash "${OPENCLAW_USER}"
  ok "Created user ${OPENCLAW_USER}"
fi

OPENCLAW_HOME="$(getent passwd "${OPENCLAW_USER}" | cut -d: -f6)"
[[ -n "${OPENCLAW_HOME}" ]] || die "Could not resolve home directory for ${OPENCLAW_USER}."

CONFIG_PATH="${OPENCLAW_HOME}/.acp/config.yml"
if [[ "$SKIP_INIT" -eq 1 ]]; then
  skip "Skipping acp init (--skip-init)"
elif [[ -f "${CONFIG_PATH}" ]]; then
  skip "ACP already configured for ${OPENCLAW_USER} (${CONFIG_PATH})"
else
  echo "   Running interactive init as ${OPENCLAW_USER}..."
  echo "   This configures consent channel + optional OpenClaw bot settings."
  if [[ -t 0 ]]; then
    run_as_user "${OPENCLAW_USER}" acp init --channel=telegram </dev/tty
  else
    run_as_user "${OPENCLAW_USER}" acp init --channel=telegram
  fi
  ok "Initialized ACP for ${OPENCLAW_USER}"
fi

if [[ "$WITH_SERVICE" -eq 1 ]]; then
  SERVICE_FILE="/etc/systemd/system/acp-openclaw.service"
  echo "   Installing systemd service: ${SERVICE_FILE}"
  run_privileged bash -c "cat > '${SERVICE_FILE}' <<UNIT
[Unit]
Description=ACP OpenClaw Gateway (v0.3.0 VM mode)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/acp start openclaw --openclaw-user=${OPENCLAW_USER}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT"
  run_privileged systemctl daemon-reload
  run_privileged systemctl enable --now acp-openclaw.service
  ok "Service enabled: acp-openclaw.service"
fi

echo ""
echo "Next command to start manually:"
echo "  sudo acp start openclaw --openclaw-user=${OPENCLAW_USER}"
echo ""
echo "Verification:"
echo "  sudo -u ${OPENCLAW_USER} -H tail -f ${OPENCLAW_HOME}/.acp/audit.jsonl"
echo ""
