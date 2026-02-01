<div align="center">

# 🔐 Agent Consent Protocol (ACP)

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
> ACP is an early research implementation. It works, it's tested, and the concept is sound — but it has not undergone formal security review and has known limitations. v0.3 adds shell/HTTP/file interception and Docker containment, significantly reducing the bypass surface, but this is still pre-audit software. Read the [Current State](#current-state) section before using it. See [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md) for the full picture.

---

## The Problem

AI agents can send emails, run shell commands, transfer money, and deploy to production — but there's no universal way to ensure a human said "yes" first.

Every framework has its own half-baked human-in-the-loop: LangGraph interrupts, CrewAI's `human_input` flag, AutoGen's `HumanProxyAgent`. They're all:

- **Framework-specific** — only works in that one ecosystem
- **Software-level** — runs inside the agent's process, so the agent can bypass it
- **No proof** — no cryptographic evidence that a human actually approved
- **No audit trail** — nothing tamper-evident for compliance or debugging

## The Solution

ACP wraps any agent process in a consent-enforced sandbox. MCP tool calls, shell commands, HTTP requests, and file access all require human approval based on your policy. In contained mode, the agent runs inside Docker with no way out except through ACP.

```bash
npm install -g agent-2fa
acp init
acp run -- python my_agent.py
```

```
┌─────────────────────────────────────────────────────┐
│  🔐 ACP Consent Request                            │
│                                                     │
│  Action:  send_email                                │
│  Risk:    🔴 HIGH                                   │
│                                                     │
│  To:      boss@company.com                          │
│  Subject: "Quarterly Report"                        │
│                                                     │
│  [✅ Approve]  [❌ Deny]                             │
└─────────────────────────────────────────────────────┘
```

The agent doesn't know ACP exists. It thinks it's talking to a normal MCP server.

---

## Current State

**Be clear about what this is and isn't.** ACP is a working prototype that demonstrates a real concept. Here's exactly where it stands today:

### ✅ What Works Now

| Feature | Status | Notes |
|---------|--------|-------|
| MCP tool call interception | **Working** | All MCP `tools/call` requests routed through consent gate |
| Shell command interception | **Working** | Wraps `exec`, `spawn`, `system` — agent shell calls go through policy |
| HTTP request interception | **Working** | Outbound HTTP/HTTPS from the agent process inspected and gated |
| File access interception | **Working** | Reads/writes to sensitive paths require approval |
| Docker containment (`--contained`) | **Working** | Agent runs in an isolated container; all I/O funnelled through ACP |
| Human approval via Telegram | **Working** | Inline Approve/Deny buttons, real-time |
| Human approval via terminal | **Working** | Interactive prompt for local dev |
| YAML policy engine | **Working** | allow/ask/deny rules with glob matching, rate limits |
| Credential vault | **Working** | AES-256-GCM encrypted, injected only after approval |
| Ed25519 signed consent proofs | **Working** | Every decision cryptographically signed |
| Hash-chained audit trail | **Working** | Tamper-evident JSONL log |
| Works with any agent/language | **Working** | Wraps any process — Python, Node, Go, whatever |
| 97 tests passing, CI green | **Working** | Automated on Node 20 + 22 |

### ⚠️ What Doesn't Work Yet

| Limitation | Impact | Planned Fix |
|-----------|--------|-------------|
| **Contained mode requires Docker** | `--contained` needs Docker installed and running | Support Podman, investigate rootless alternatives |
| **Non-contained mode can be bypassed** | Without `--contained`, shell/HTTP interception relies on LD_PRELOAD-style hooks that a determined agent could circumvent | Always recommend `--contained` for untrusted agents |
| **Same OS user (non-contained)** | Without `--contained`, agent runs as same user as ACP — could read config, keys, vault files | Use `--contained` for isolation |
| **Private key unencrypted** | Ed25519 key stored as plaintext at `~/.acp/keys/` | Encrypt at rest with passphrase |
| **No replay protection** | Consent proofs have nonces but no server-side nonce store | Nonce persistence + TTL |

### 🔑 The Key Limitation

**Without `--contained`, ACP's shell/HTTP interception is best-effort.** The hooks work against well-behaved agents but a sufficiently adversarial process could bypass them. This is inherent to userspace interception.

**With `--contained`, the bypass gap is closed.** The agent runs inside a Docker container with no network access except back to the ACP proxy. All shell commands, HTTP requests, and file writes are funnelled through ACP's consent gate. There is no path out of the container that doesn't go through policy enforcement.

This means:
- ✅ **Use `acp run --contained`** for untrusted agents or production workloads — the agent cannot bypass ACP
- ✅ **Use `acp run`** (without `--contained`) for trusted agents during development — convenient and catches MCP + most shell/HTTP calls
- ✅ **Use ACP** as an additional safety layer alongside other controls
- ❌ **Don't rely on non-contained mode alone** if your agent is adversarial or untrusted

---

## How It Works

```
                          ┌──────────────────────────────────────┐
                          │         Docker Container             │
                          │        (--contained mode)            │
                          │                                      │
Agent  ──→  Shell Hook  ──┤──→  ACP Proxy  ──→  Policy Engine   │
        ──→  HTTP Hook  ──┤        │                  ↓          │
        ──→  MCP Calls  ──┤        │        📱 Telegram / Terminal
                          │        ↓                             │
                          │   Real MCP Server / Network / Disk   │
                          └──────────────────────────────────────┘
```

**Enforcement layers:**

1. **MCP Proxy** — All MCP tool calls intercepted. Policy engine decides: allow, ask, or deny. This is the core of ACP.
2. **Shell Interception** — Calls to `exec`, `spawn`, `system`, and similar are intercepted and routed through the consent gate.
3. **HTTP Interception** — Outbound HTTP/HTTPS requests are inspected against policy before being forwarded.
4. **Docker Containment** *(optional, `--contained`)* — Agent runs in an isolated container with no direct network or filesystem access. All I/O goes through the ACP proxy. This is the strongest enforcement mode.
5. **Credential Isolation** — API keys stored in ACP's encrypted vault (AES-256-GCM). Injected only after human approval. Agent never sees raw credentials.

**Cryptographic guarantees:**

- Every consent decision is signed with Ed25519 keys
- Hash-chained JSONL audit trail (tamper-evident)
- Canonical JSON serialization for deterministic signing

---

## Install

```bash
# npm
npm install -g agent-2fa

# Or run directly
npx agent-2fa init
npx agent-2fa run -- python my_agent.py

# Or from source
git clone https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install && npm run build
node dist/index.js --help
```

---

## Quick Start

### Level 1 — Terminal Prompts (30 seconds)

```bash
acp init --channel=prompt
acp run -- python my_agent.py
```

Every MCP tool call pops a terminal prompt. Good for testing.

### Level 2 — Mobile Approvals (2 minutes)

```bash
acp init --channel=telegram
acp secret set OPENAI_API_KEY=sk-...
acp run -- node my_agent.js
```

Tool calls appear on your phone. Approve or deny with one tap.

### Level 3 — With Network Isolation (requires root)

```bash
acp policy apply policies/strict.yml
acp secret set STRIPE_KEY=sk_live_...
sudo acp run --network-isolation -- python production_agent.py
```

Agent can only talk to ACP proxy. Everything else is dropped.

### Level 4 — Docker Containment (recommended for untrusted agents)

```bash
acp setup                              # one-time: pulls base image
acp run --contained -- python my_agent.py
```

Agent runs inside a Docker container. No network, no filesystem access, no shell commands — unless ACP approves them. This is the strongest mode.

```bash
# Custom image and workspace
acp run --contained --image=python:3.12-slim --workspace=./project -- python agent.py
```

---

## Policy Engine

```yaml
version: "1"
default_action: ask

rules:
  - match: { category: read }
    action: allow

  - match: { tool: exec }
    action: ask
    level: high

  - match: { category: financial }
    action: ask
    level: critical
    timeout: 300

  - match: { tool: "*" }
    rate_limit: 20/minute
```

Three built-in policies: `default.yml`, `strict.yml`, `development.yml`. See [Policy Reference](docs/policy-reference.md).

---

## Credential Vault

Secrets encrypted at rest (AES-256-GCM, key derived from Ed25519 private key via HKDF). Never exposed to the agent process.

```bash
acp secret set OPENAI_API_KEY=sk-...
acp secret list
acp secret remove OPENAI_API_KEY
```

---

## Comparison

| Feature | ACP (v0.3) | LangGraph | CrewAI |
|---|:---:|:---:|:---:|
| Works with any agent/language | ✅ | ❌ | ❌ |
| Intercepts MCP tool calls | ✅ | ❌ | ❌ |
| Intercepts non-MCP actions | ✅ (contained mode) | Partial | Partial |
| Network-level enforcement | ✅ (contained mode) | ❌ | ❌ |
| Credential isolation | ✅ | ❌ | ❌ |
| Mobile approval (Telegram) | ✅ | ❌ | ❌ |
| Signed consent proofs | ✅ | ❌ | ❌ |
| Tamper-evident audit trail | ✅ | ❌ | ❌ |
| Zero code changes to agent | ✅ | ❌ | ❌ |
| Agent can bypass (MCP calls) | No | Yes | Yes |
| Agent can bypass (non-MCP) | No (contained mode) | Yes | Yes |

---

## Works With Everything

```bash
acp run -- openclaw gateway        # OpenClaw
acp run -- python my_agent.py      # Python
acp run -- node agent.js           # Node.js
acp run -- ./my-go-agent           # Go
acp run -- java -jar agent.jar     # Java

# Contained mode — full isolation
acp run --contained -- openclaw gateway
acp run --contained -- python my_agent.py
acp run --contained -- node agent.js
```

**Without `--contained`:** ACP intercepts MCP tool calls and hooks shell/HTTP calls. Works well for trusted agents but a determined agent could bypass the hooks.

**With `--contained`:** Agent runs in Docker. All I/O goes through ACP. No bypass path exists.

---

## Running Claude Code in Contained Mode

You can run Claude Code inside ACP's Docker containment. Every HTTP request, shell command, and file access Claude Code makes goes through ACP's consent gate.

### Quick setup

```bash
# 1. Set up Telegram for approvals (interactive Claude Code needs it)
acp init --channel=telegram

# 2. Build the Docker image (one-time, includes Node.js + git + curl)
acp setup claude-code-contained

# 3. Run Claude Code interactively
acp run --contained --interactive --channel=telegram --image claude-code-acp -- claude
```

Claude Code launches in your terminal. Consent requests go to your Telegram bot — approve or deny from your phone.

### Why Telegram?

Claude Code is interactive — it needs stdin for your input. ACP's terminal consent prompt also needs stdin. Since both can't share it, consent goes to Telegram (or a webhook) instead.

### Non-interactive mode

For one-shot tasks, use `--print`. No Telegram needed — ACP uses terminal prompts:

```bash
acp run --contained --image claude-code-acp -- claude --print "What files are in /workspace?"
```

### Policy for Claude Code

Claude Code connects to `api.anthropic.com` and `platform.claude.com`. Add these to your policy (`~/.acp/policy.yml`) so they're auto-approved:

```yaml
version: "2"
default_action: ask
rules:
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
  - match: { kind: http, host: "*.claude.com" }
    action: allow
  # ... your other rules
```

### Custom image

The `acp setup claude-code-contained` command builds a `claude-code-acp` image with Node.js, Claude Code, git, curl, and wget. To customize it, see [`docker/Dockerfile.claude-code`](docker/Dockerfile.claude-code).

---

## Roadmap

ACP is at the **concept + working CLI** stage. Here's where it's heading:

| Phase | Status | What |
|-------|--------|------|
| **v0.2** | ✅ Released | MCP proxy, consent gate, policy engine, Telegram, vault, audit trail |
| **v0.3 — Current** | ✅ Released | Shell/HTTP/file interception, Docker containment (`--contained`), setup command, 97 tests |
| **v0.4 — Ecosystem** | 🔄 Next | Slack/Discord channels, web dashboard, importable library (not just CLI) |
| **v1.0 — Production** | Planned | Formal security audit, stable API, container-first deployment |

See [THREAT-MODEL.md](THREAT-MODEL.md) for the detailed gap analysis.

---

## CLI Reference

```
acp init [--channel=prompt|telegram|webhook]    Setup wizard
acp setup                                       Pull Docker images, configure containment
acp run [options] -- CMD                        Run agent in sandbox
    --contained                                 Docker containment (recommended)
    --interactive                               Pass stdin to container (for interactive agents)
    --image=IMAGE                               Custom Docker image for contained mode
    --workspace=PATH                            Mount workspace directory into container
    --env=KEY                                   Forward host env var to container (repeatable)
    --channel=TYPE                              Override consent channel (prompt/telegram/webhook)
    --policy=FILE                               Policy file to use
    --no-shell-intercept                        Disable shell interception
    --no-http-intercept                         Disable HTTP interception
acp secret set|list|remove                      Credential vault
acp policy apply|show                           Policy management
acp status                                      Show status
```

---

## Testing

```bash
cd cli
npm install
npm test    # 97 tests
```

---

## Documentation

- [How It Works](docs/how-it-works.md)
- [Network Isolation](docs/network-isolation.md)
- [Policy Reference](docs/policy-reference.md)
- [Integration Guide](docs/integration-guide.md)
- [Protocol Spec](SPEC.md)
- [Security Policy](SECURITY.md)
- [Threat Model](THREAT-MODEL.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We especially need help with:

- 🔌 Channel adapters (Slack, Discord, Signal, web dashboard)
- 🧪 Security review and threat modelling
- 📖 Documentation and tutorials
- 🐧 Podman and rootless container support

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Agents use tools. Humans authorize them.**

[⭐ Star on GitHub](https://github.com/o1100/Agent-Consent-Protocol) · [🌐 Website](https://agent2fa.dev)

</div>
