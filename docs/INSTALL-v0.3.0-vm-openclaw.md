# ACP v0.3.0 Install and Operations (Linux VM + OpenClaw)

Status: Current operational runbook for this repo

## Supported Baseline

- Ubuntu 22.04+ / Debian-compatible Linux VM
- root/sudo access
- Node.js 22+
- nftables userspace tool (`nft`)
- build toolchain (`build-essential`) for native npm dependencies

## 0) Host prerequisites

```bash
sudo apt-get update -y
sudo apt-get install -y nftables build-essential ca-certificates
```

## 1) Install ACP

### npm path

```bash
npm install -g agent-2fa
acp --version
```

### source path

```bash
git clone --branch v0.3.0 https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install
npm run build
sudo npm link
acp --version
```

## 2) Create OpenClaw runtime user

```bash
sudo useradd -m -s /bin/bash openclaw || true
```

## 3) Initialize config as OpenClaw user

```bash
sudo -u openclaw -H acp init --channel=telegram
```

The wizard creates:

- `/home/openclaw/.acp/config.yml`
- `/home/openclaw/.acp/policy.yml`
- optional `/home/openclaw/.openclaw/openclaw.json`

## 4) Start ACP VM mode

```bash
sudo acp start openclaw --openclaw-user=openclaw
```

What this command does:

1. validates Linux + root + nftables prerequisites
2. prepares OpenClaw workspace
3. starts local consent HTTP proxy
4. installs nftables egress rules for `openclaw` UID
5. starts OpenClaw gateway under `openclaw` user

On first run, it may install `openclaw@latest` and compile native dependencies.

## 5) Verification

In one terminal:

```bash
sudo -u openclaw -H tail -f /home/openclaw/.acp/audit.jsonl
```

Then trigger a networked action from OpenClaw and confirm:

1. consent prompt arrives on configured channel
2. allow/deny decision is logged

## 6) Recommended Hardening

For stronger tamper resistance than current defaults:

1. move ACP policy/config to root-owned `/etc/acp`
2. move state/audit to root-owned `/var/lib/acp` and `/var/log/acp`
3. run as root-owned systemd service
4. remove write access for `openclaw` user to policy/config path

## 7) Legacy Path

`acp contain` Docker mode is still available for compatibility, but not the recommended primary deployment for OpenClaw in `v0.3.0`.
