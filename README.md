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
> **Experimental prototype (v0.2) — not production hardened.**
> ACP is an early research implementation. It works, it's tested, and the concept is sound — but it has not undergone formal security review and has known limitations. Read the [Current State](#current-state) section before using it. See [SECURITY.md](SECURITY.md) and [THREAT-MODEL.md](THREAT-MODEL.md) for the full picture.

---

## The Problem

AI agents can send emails, run shell commands, transfer money, and deploy to production — but there's no universal way to ensure a human said "yes" first.

Every framework has its own half-baked human-in-the-loop: LangGraph interrupts, CrewAI's `human_input` flag, AutoGen's `HumanProxyAgent`. They're all:

- **Framework-specific** — only works in that one ecosystem
- **Software-level** — runs inside the agent's process, so the agent can bypass it
- **No proof** — no cryptographic evidence that a human actually approved
- **No audit trail** — nothing tamper-evident for compliance or debugging

## The Solution

ACP wraps any agent process in a consent-enforced proxy. Sensitive MCP tool calls require human approval. The agent never touches your credentials.

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
| Human approval via Telegram | **Working** | Inline Approve/Deny buttons, real-time |
| Human approval via terminal | **Working** | Interactive prompt for local dev |
| YAML policy engine | **Working** | allow/ask/deny rules with glob matching, rate limits |
| Credential vault | **Working** | AES-256-GCM encrypted, injected only after approval |
| Ed25519 signed consent proofs | **Working** | Every decision cryptographically signed |
| Hash-chained audit trail | **Working** | Tamper-evident JSONL log |
| Works with any agent/language | **Working** | Wraps any process — Python, Node, Go, whatever |
| 56 tests passing, CI green | **Working** | Automated on Node 20 + 22 |

### ⚠️ What Doesn't Work Yet

| Limitation | Impact | Planned Fix |
|-----------|--------|-------------|
| **MCP-only** | Agents using direct HTTP, shell `exec()`, or non-MCP interfaces bypass ACP entirely | Network isolation + broader interception |
| **Network isolation needs root/Docker** | Without `sudo` or Docker, there's no network enforcement — agent can make direct requests | Rootless isolation (LD_PRELOAD, eBPF) |
| **Same OS user** | Agent runs as same user as ACP — could read config, keys, vault files | Container isolation, separate user |
| **Private key unencrypted** | Ed25519 key stored as plaintext at `~/.acp/keys/` | Encrypt at rest with passphrase |
| **No replay protection** | Consent proofs have nonces but no server-side nonce store | Nonce persistence + TTL |
| **HTTP proxy is a stub** | Non-MCP HTTP interception returns 501 | Full HTTP MITM proxy |

### 🔑 The Key Limitation

**ACP only intercepts MCP tool calls.** If your agent uses MCP for all its tools (which is increasingly common), ACP catches everything. If your agent also makes direct HTTP requests, runs shell commands outside MCP, or uses framework-native tools — those actions bypass ACP completely.

This means:
- ✅ **Use ACP** when your agent's dangerous actions go through MCP servers
- ✅ **Use ACP** as an additional safety layer alongside other controls
- ❌ **Don't rely on ACP alone** if your agent has unrestricted shell/network access
- ❌ **Don't treat this as a security boundary** without network isolation enabled

---

## How It Works

```
Agent  →  ACP Proxy  →  Policy Engine  →  Human Approval  →  Real MCP Server
                              ↓
                    📱 Telegram / Terminal
```

**Enforcement layers:**

1. **MCP Proxy** — All MCP tool calls intercepted. Policy engine decides: allow, ask, or deny. This is the core of ACP and it works today.
2. **Credential Isolation** — API keys stored in ACP's encrypted vault (AES-256-GCM). Injected only after human approval. Agent never sees raw credentials.
3. **Network Isolation** *(optional, requires root/Docker)* — Restricts agent to only reach the ACP proxy. Without this, enforcement depends on the agent routing through MCP. See [Network Isolation docs](docs/network-isolation.md).

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

| Feature | ACP (v0.2) | LangGraph | CrewAI |
|---|:---:|:---:|:---:|
| Works with any agent/language | ✅ | ❌ | ❌ |
| Intercepts MCP tool calls | ✅ | ❌ | ❌ |
| Intercepts non-MCP actions | ❌ | Partial | Partial |
| Network-level enforcement | Root/Docker only | ❌ | ❌ |
| Credential isolation | ✅ | ❌ | ❌ |
| Mobile approval (Telegram) | ✅ | ❌ | ❌ |
| Signed consent proofs | ✅ | ❌ | ❌ |
| Tamper-evident audit trail | ✅ | ❌ | ❌ |
| Zero code changes to agent | ✅ | ❌ | ❌ |
| Agent can bypass (MCP calls) | No | Yes | Yes |
| Agent can bypass (non-MCP) | Yes | Yes | Yes |

---

## Works With Everything

```bash
acp run -- openclaw gateway        # OpenClaw
acp run -- python my_agent.py      # Python
acp run -- node agent.js           # Node.js
acp run -- ./my-go-agent           # Go
acp run -- java -jar agent.jar     # Java
```

**Caveat:** ACP only intercepts MCP tool calls. If your agent makes direct API calls or runs shell commands outside of MCP, those won't go through ACP. See [Current State](#current-state).

---

## Roadmap

ACP is at the **concept + working CLI** stage. Here's where it's heading:

| Phase | Status | What |
|-------|--------|------|
| **v0.2 — Current** | ✅ Released | MCP proxy, consent gate, policy engine, Telegram, vault, audit trail |
| **v0.3 — Hardening** | 🔄 Next | Replay protection, consent binding to args, encrypted private keys, default-deny unknown tools |
| **v0.4 — Broader Interception** | Planned | HTTP MITM proxy, shell command interception, rootless network isolation |
| **v0.5 — Ecosystem** | Planned | Slack/Discord channels, web dashboard, importable library (not just CLI) |
| **v1.0 — Production** | Planned | Formal security audit, stable API, container-first deployment |

See [THREAT-MODEL.md](THREAT-MODEL.md) for the detailed gap analysis.

---

## CLI Reference

```
acp init [--channel=prompt|telegram|webhook]    Setup wizard
acp run [--network-isolation] [--policy] -- CMD Run agent in sandbox
acp secret set|list|remove                      Credential vault
acp policy apply|show                           Policy management
acp status                                      Show status
```

---

## Testing

```bash
cd cli
npm install
npm test    # 56 tests
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

- 🐧 Rootless network isolation (LD_PRELOAD, eBPF, seccomp)
- 🌐 HTTP proxy interception (non-MCP traffic)
- 🔌 Channel adapters (Slack, Discord, Signal, web dashboard)
- 🧪 Security review and threat modelling
- 📖 Documentation and tutorials

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Agents use tools. Humans authorize them.**

[⭐ Star on GitHub](https://github.com/o1100/Agent-Consent-Protocol) · [🌐 Website](https://agent2fa.dev)

</div>
