# ACP Linux VM Install Skill

Purpose: install and validate ACP `v0.3.0` for OpenClaw on a Linux VM with fail-closed egress mediation.

Use this when:
- setting up a new VM
- rebuilding a VM from scratch
- validating that ACP runtime wiring is healthy after upgrades

## Preconditions

- Ubuntu/Debian Linux VM
- root/sudo access
- outbound internet access for package installs
- Node.js `>=22`
- Telegram consent bot token + chat ID
- optional OpenClaw messaging bot + model credentials

## One-time host dependencies

```bash
sudo apt-get update -y
sudo apt-get install -y nftables build-essential ca-certificates
```

`build-essential` is required because `openclaw@latest` may pull native dependencies that compile during first start.

## Install ACP

### npm install

```bash
sudo npm install -g agent-consent-protocol
acp --version
```

### source install

```bash
git clone --branch v0.3.0 https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install --no-audit --no-fund
npm run build
PKG=$(npm pack | tail -n1)
sudo npm install -g "./${PKG}" --force
acp --version
```

## Configure runtime user

```bash
sudo useradd -m -s /bin/bash openclaw || true
sudo -u openclaw -H acp init --channel=telegram
```

## Start ACP VM mode

```bash
sudo acp start openclaw --openclaw-user=openclaw
```

Expected runtime:
- ACP proxy listens on loopback (`127.0.0.1:8444` by default)
- nftables table `inet acp_vm_v030` exists
- `openclaw-gateway` runs as `openclaw`
- startup lock prevents duplicate `acp start openclaw` processes

## Validation checklist

```bash
acp --version
ps -eo pid,ppid,user,args | grep -E "acp start openclaw|openclaw-gateway" | grep -v grep
sudo nft list table inet acp_vm_v030
sudo -u openclaw -H tail -f /home/openclaw/.acp/audit.jsonl
```

Functional consent test:
1. trigger a new outbound host from OpenClaw
2. confirm consent prompt arrives in Telegram
3. approve once for `example.com`
4. retry `www.example.com` immediately and verify cached-host approval behavior

## Common failure modes

- `npm install openclaw@latest` fails with missing `make` or build errors:
  - install `build-essential`, retry `acp start`
- `EACCES` under `.openclaw/agents/...`:
  - fixed in current code path; if migrating old state, run
    - `sudo chown -R openclaw:openclaw /home/openclaw/openclaw-workspace`
- duplicate ACP supervisors:
  - current release blocks with startup lock and exits fast

## Operational hardening (recommended)

- move policy/config to root-owned paths (for example `/etc/acp`)
- move audit/state to root-owned `/var/lib/acp` and `/var/log/acp`
- run ACP as a root-owned systemd unit
