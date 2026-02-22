<div align="center">

# Agent Consent Protocol (ACP)

### MCP is how agents use tools. ACP is how humans control agents.

**v0.3.0: Linux VM-first consent gating for OpenClaw**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm: agent-consent-protocol](https://img.shields.io/npm/v/agent-consent-protocol.svg)](https://www.npmjs.com/package/agent-consent-protocol)
[![Node.js CI](https://github.com/o1100/Agent-Consent-Protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/o1100/Agent-Consent-Protocol/actions)

[Website](https://agent2fa.dev) · [Spec](SPEC.md) · [Docs](docs/) · [Contributing](CONTRIBUTING.md)

</div>

---

> [!WARNING]
> Experimental prototype (`v0.3.0`). ACP is functional but not formally audited.
> Use it for controlled environments, not high-assurance production security.

## What v0.3.0 Is

`v0.3.0` is optimized for one target: **OpenClaw running on Linux cloud VMs**.

Primary flow:

1. `acp init --channel=telegram` (as the OpenClaw runtime user)
2. `sudo acp start openclaw --openclaw-user=openclaw`

At runtime ACP:

- Runs a local consent-gated HTTP proxy on loopback
- Applies fail-closed nftables egress rules for the OpenClaw Linux user
- Requires human approval for policy-matched outbound HTTP/HTTPS actions
- Writes append-only JSONL audit records

## Quick Start (Linux VM)

```bash
# 0) One-time host prerequisites
sudo apt-get update -y
sudo apt-get install -y nftables build-essential

# 1) Install ACP
npm install -g agent-consent-protocol

# 2) Create runtime user once (if missing)
sudo useradd -m -s /bin/bash openclaw || true

# 3) Configure consent + OpenClaw config as that user
sudo -u openclaw -H acp init --channel=telegram

# 4) Start ACP + OpenClaw VM mode
sudo acp start openclaw --openclaw-user=openclaw
```

Full guide: [examples/openclaw/README.md](examples/openclaw/README.md)

Note: `build-essential` is required because `openclaw@latest` may compile native dependencies during first startup.

## Security Model (Current)

`v0.3.0` enforces **network mediation**, not full host immutability:

- OpenClaw runs as a non-root Linux user
- nftables blocks direct outbound egress from that user
- only loopback proxy path is allowed for TCP egress
- default decision path is fail-closed

Important current limitation:

- If ACP config/policy lives in `/home/openclaw/.acp`, OpenClaw can modify it.
- ACP binaries installed under root-owned paths are not writable by OpenClaw.

Recommended hardening for stricter deployments:

- Store ACP policy/config in root-owned locations (`/etc/acp`)
- Store state/logs under root-owned paths (`/var/lib/acp`, `/var/log/acp`)
- Run ACP as a root-owned systemd unit

## Legacy Mode (`acp contain`)

`acp contain -- <command>` remains available as a compatibility mode for generic agents and Docker-based workflows.

It is no longer the primary path for `v0.3.0` OpenClaw VM deployments.

## Install Options

### npm

```bash
npm install -g agent-consent-protocol
acp --version
```

### From source

```bash
git clone --branch v0.3.0 https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install
npm run build
sudo npm link
acp --version
```

### Ubuntu/Debian helper script

```bash
curl -fsSL https://raw.githubusercontent.com/o1100/Agent-Consent-Protocol/v0.3.0/install.sh | bash
```

## CLI Reference

```text
acp init [--channel=prompt|telegram|webhook]
    --config=DIR

acp start <preset>
    --openclaw-user=USER
    --workspace=DIR
    --http-proxy-port=PORT
    --config=DIR

acp contain [options] -- CMD   (legacy compatibility mode)
    --channel=TYPE
    --policy=FILE
    --image=IMAGE
    --workspace=PATH
    --interactive
    --writable
    --env=KEY
    --config=DIR
    --consent-port=PORT
    --http-proxy-port=PORT
```

## What Changed From v0.2

See: [docs/v0.2-to-v0.3.0.md](docs/v0.2-to-v0.3.0.md)

## Documentation

- [How It Works](docs/how-it-works.md)
- [Integration Guide](docs/integration-guide.md)
- [Network Isolation](docs/network-isolation.md)
- [Policy Reference](docs/policy-reference.md)
- [Design: v0.3.0 VM OpenClaw](docs/DESIGN-v0.3.0-vm-openclaw.md)
- [Install Standard: v0.3.0 VM OpenClaw](docs/INSTALL-v0.3.0-vm-openclaw.md)
- [Agent Install Skill](SKILL.md)
- [v0.2 to v0.3.0 Delta](docs/v0.2-to-v0.3.0.md)
- [Release Readiness: v0.3.0](docs/RELEASE-READINESS-v0.3.0.md)
- [Protocol Spec](SPEC.md)
- [Security Policy](SECURITY.md)
- [Threat Model](THREAT-MODEL.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Agents use tools. Humans authorize them.**

</div>
