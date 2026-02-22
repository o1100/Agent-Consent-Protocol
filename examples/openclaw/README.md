# OpenClaw + ACP Setup (`v0.3.0`)

Run OpenClaw behind ACP consent gating on a Linux VM.

## Prerequisites

- Linux VM (Ubuntu 22.04+/24.04+ recommended)
- Node.js 22+
- root/sudo access
- `nft` (nftables userspace tool)
- `build-essential` (required for native npm dependency builds on first start)
- Two Telegram bots:
  - consent bot (ACP approvals)
  - messaging bot (OpenClaw chat interface)

Install prerequisites:

```bash
sudo apt-get update -y
sudo apt-get install -y nftables build-essential
```

## Install ACP

```bash
npm install -g agent-2fa
acp --version
```

Or from source:

```bash
git clone --branch v0.3.0 https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install
npm run build
sudo npm link
```

## Configure runtime user

```bash
sudo useradd -m -s /bin/bash openclaw || true
sudo -u openclaw -H acp init --channel=telegram
```

`acp init` will:

1. configure consent bot token/chat id (`/home/openclaw/.acp/config.yml`)
2. create default policy (`/home/openclaw/.acp/policy.yml`)
3. optionally configure OpenClaw messaging bot (`/home/openclaw/.openclaw/openclaw.json`)

## Start OpenClaw in ACP VM mode

```bash
sudo acp start openclaw --openclaw-user=openclaw
```

This command:

- prepares `/home/openclaw/openclaw-workspace`
- installs `openclaw@latest`
- launches ACP local proxy + consent gate
- enforces nftables egress constraints for `openclaw`
- starts OpenClaw gateway as `openclaw`

## Verify

```bash
sudo -u openclaw -H tail -f /home/openclaw/.acp/audit.jsonl
```

Send a message to your OpenClaw messaging bot that triggers web access.
You should receive a consent prompt on your consent bot channel.

## Notes

- `acp contain` still exists as a legacy Docker compatibility path.
- `v0.3.0` primary model is Linux VM OpenClaw mode.
