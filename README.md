<div align="center">

# Agent Consent Protocol (ACP)

### MCP is how agents use tools. ACP is how humans control agents.

**One command. Any agent. Human-controlled.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm: agent-2fa](https://img.shields.io/npm/v/agent-2fa.svg)](https://www.npmjs.com/package/agent-2fa)
[![Node.js CI](https://github.com/o1100/Agent-Consent-Protocol/actions/workflows/ci.yml/badge.svg)](https://github.com/o1100/Agent-Consent-Protocol/actions)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Website](https://agent2fa.dev) · [Spec](SPEC.md) · [Docs](docs/) · [Contributing](CONTRIBUTING.md)

</div>

---

> [!WARNING]
> **Experimental prototype (v0.3) — not production hardened.**
> ACP is a working implementation with 47 tests passing. The concept is sound and the container-based isolation is real, but it has not undergone formal security review. On Linux, isolation is kernel-enforced. On macOS/Windows, isolation is proxy-enforced and weaker. Read the [Platform Differences](#platform-differences) section. See [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md) for the full picture.

---

## The Problem

AI agents can send emails, run shell commands, transfer money, and deploy to production — but there's no universal way to ensure a human said "yes" first.

Every framework has its own half-baked human-in-the-loop. They're all:

- **Framework-specific** — only works in that one ecosystem
- **Software-level** — runs inside the agent's process, so the agent can bypass it
- **No enforcement** — nothing stops the agent from ignoring it
- **No audit trail** — no record of what happened

## The Solution

ACP runs any agent inside a Docker container with no direct internet access. Two layers of interception catch shell commands and HTTP requests. Every sensitive action requires human approval via your phone. The agent can't bypass it — the container has no way out except through ACP.

```bash
npm install -g agent-2fa
acp init
acp contain -- python my_agent.py
```

```
+------------------------------------------------------+
|  ACP Consent Request (Telegram)                      |
|                                                      |
|  Command:  gh commit -m "deploy to prod"             |
|  Policy:   ask                                       |
|                                                      |
|  [Approve]  [Deny]                                   |
+------------------------------------------------------+
```

The agent doesn't know ACP exists. It thinks it's running normally.

---

## How It Works

```
HOST MACHINE
+----------------------------------------------------------+
|  ACP Process                                             |
|    Consent Gate  <--  Policy (YAML rules)                |
|         |                                                |
|         +-- Channel (Telegram / Terminal / Webhook)       |
|         +-- Audit Log (append-only JSONL)                |
|                                                          |
|    :8443  Consent server (shell wrapper callbacks)       |
|    :8444  HTTP forward proxy                             |
+---------------------------+------------------------------+
                            | Docker internal network
+---------------------------v------------------------------+
|  AGENT CONTAINER                                         |
|  --read-only --cap-drop=ALL --no-new-privileges          |
|                                                          |
|  Shell wrappers intercept: gh, git, curl, rm, ...        |
|  HTTP_PROXY forces all traffic through ACP               |
|  /workspace (mounted, writable)                          |
+----------------------------------------------------------+
```

**Two layers of interception:**

1. **Layer 1: Shell Wrappers** — Wraps commands like `gh`, `curl`, `rm` inside the container. When the agent runs `gh commit`, the wrapper calls ACP for approval before executing. Provides semantic context (knows it's `gh commit` vs `gh pr list`).

2. **Layer 2: HTTP Proxy** — All outbound HTTP/HTTPS traffic is forced through ACP's proxy. Catches anything that bypasses shell wrappers — direct API calls, Python `requests`, raw HTTP clients.

When a command is approved at Layer 1, its resulting network traffic auto-passes Layer 2 (via a short-lived token) to avoid double-prompting.

**Why containers?** Shell wrappers alone are bypassable (download a new binary, use raw syscalls). Network proxies alone can be ignored (agent can make direct TCP connections). Containers make both robust: read-only filesystem prevents installing bypass tools, `--internal` network prevents direct internet access.

---

## Quick Start

### Terminal Prompts (fastest)

```bash
acp init --channel=prompt
acp contain -- python my_agent.py
```

Every action pops a terminal prompt. Good for testing.

### Mobile Approvals (recommended)

```bash
acp init --channel=telegram
acp contain -- python my_agent.py
```

Actions appear on your phone. Approve or deny with one tap.

---

## Policy Engine

Simple YAML. Rules top-to-bottom, first match wins, else default.

```yaml
default: ask

wrap:
  - gh
  - git
  - curl
  - rm
  - psql

rules:
  # Safe read commands
  - match: { name: "cat" }
    action: allow
  - match: { name: "ls" }
    action: allow
  - match: { name: "gh", args: "pr list*" }
    action: allow

  # Safe HTTP destinations
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
  - match: { kind: http, host: "api.github.com" }
    action: allow

  # Needs approval
  - match: { name: "gh", args: "commit*" }
    action: ask
    timeout: 120
  - match: { name: "rm" }
    action: ask

  # Never allow
  - match: { name: "rm", args: "-rf /*" }
    action: deny
```

The `wrap` list determines which commands get shell wrappers (Layer 1). Everything else still hits Layer 2 (HTTP proxy) if it makes network requests.

Three built-in policy templates: `default.yml`, `strict.yml`, `openclaw.yml`. See [Policy Reference](docs/policy-reference.md).

---

## Platform Differences

ACP works on any OS with Docker, but isolation strength varies:

| | Linux | macOS / Windows |
|---|---|---|
| Docker network | `--internal` (no gateway) | Bridge + proxy env vars |
| Isolation | Kernel-enforced | Proxy-enforced (weaker) |
| Shell wrappers | Protected by read-only FS | Protected by read-only FS |
| Container hardening | Full | Full |
| Known gap | None | Agent could bypass proxy with direct TCP |

**Linux** is the recommended platform for untrusted agents. Docker `--internal` networks have no outbound gateway at the kernel level — the agent literally cannot reach the internet.

**macOS/Windows** works for typical agents but a deliberately adversarial agent could bypass the proxy env vars by making direct TCP connections to raw IPs.

### Future: Docker Desktop microVM Sandboxes

Docker Desktop offers [microVM-based sandboxes](https://docs.docker.com/ai/sandboxes/) on macOS/Windows that would provide strong isolation. However, `docker sandbox run` currently only supports a hardcoded list of agents (Claude, Gemini) and doesn't allow custom agents. When Docker adds support for arbitrary agents, ACP will integrate with microVM sandboxes for full cross-platform isolation.

---

## ACP Features

| Feature | ACP (v0.3) |
|---|:---:|
| Works with any agent/language | Yes |
| Network-level enforcement (Docker) | Yes |
| Shell command interception | Yes |
| HTTP request interception | Yes |
| Mobile approval (Telegram) | Yes |
| Zero code changes to agent | Yes |
| Agent can't bypass (container) | Yes |
| Audit trail | Yes |

Designed for [OpenClaw](https://github.com/o1100/OpenClaw) — works with any command.

---

## Works With Any Agent

```bash
# OpenClaw (primary) — requires workspace setup, see examples/openclaw/
acp contain --workspace=./my-workspace \
  --env=ANTHROPIC_API_KEY \
  -- node /workspace/node_modules/openclaw/openclaw.mjs gateway

# Python / Node.js / Go / Java — just works
acp contain -- python my_agent.py
acp contain -- node agent.js
acp contain -- ./my-go-agent
acp contain -- java -jar agent.jar
```

OpenClaw is the primary supported agent. See [examples/openclaw/](examples/openclaw/) for the full setup guide. ACP wraps any process — no code changes needed.

---

## Prerequisites

- **Node.js >= 22** — [install via NodeSource](https://github.com/nodesource/distributions) or `nvm`
- **Docker** — [install Docker Engine](https://docs.docker.com/engine/install/) (Linux) or Docker Desktop (macOS/Windows)
- **At least 512MB RAM** — Docker image pulls and npm installs can OOM on very small VMs. Add swap if running on a constrained machine.

## Install

```bash
# npm (recommended)
npm install -g agent-2fa

# Or run directly
npx agent-2fa init
npx agent-2fa contain -- python my_agent.py

# Or from source (e.g. to test a branch)
git clone https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install && npm run build && npm link
acp --help
```

---

## CLI Reference

```
acp init [--channel=prompt|telegram|webhook]    Setup wizard
    --config=DIR                                ACP config directory (default: ~/.acp)

acp contain [options] -- CMD                    Run agent in contained Docker sandbox
    --channel=TYPE                              Override consent channel
    --policy=FILE                               Policy file to use
    --image=IMAGE                               Custom Docker image
    --workspace=PATH                            Mount workspace directory
    --interactive                               Pass stdin to container
    --writable                                  Make container filesystem writable
    --env=KEY                                   Forward host env var (repeatable)
    --config=DIR                                ACP config directory (default: ~/.acp)
    --consent-port=PORT                         Consent server port (default: 8443)
    --http-proxy-port=PORT                      HTTP proxy port (default: 8444)
```

---

## Testing

```bash
cd cli
npm install
npm test    # 47 tests
```

---

## Roadmap

| Phase | Status | What |
|-------|--------|------|
| **v0.2** | Done | MCP proxy, consent gate, policy engine, Telegram, vault, audit trail |
| **v0.3 — Current** | Done | Container-first redesign, shell/HTTP interception, Docker containment, two-layer interception, 47 tests |
| **v0.4 — Next** | Planned | Slack/Discord channels, Docker microVM integration (when available), gVisor runtime option |
| **v1.0** | Planned | Formal security audit, FUSE workspace overlay, Firecracker microVM support |

---

## Documentation

- [How It Works](docs/how-it-works.md)
- [Network Isolation](docs/network-isolation.md)
- [Policy Reference](docs/policy-reference.md)
- [Integration Guide](docs/integration-guide.md)
- [Design Document](docs/DESIGN-v1.md)
- [Protocol Spec](SPEC.md)
- [Security Policy](SECURITY.md)
- [Threat Model](THREAT-MODEL.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We especially need help with:

- Channel adapters (Slack, Discord, Signal, web dashboard)
- Security review and container escape analysis
- Documentation and tutorials
- gVisor and Firecracker runtime support

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Agents use tools. Humans authorize them.**

[Star on GitHub](https://github.com/o1100/Agent-Consent-Protocol) · [Website](https://agent2fa.dev)

</div>
