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

## The Problem

AI agents can send emails, run shell commands, transfer money, and deploy to production — but there's no universal way to ensure a human said "yes" first. Existing frameworks bury consent in application code where agents can bypass it.

## The Solution

ACP wraps any agent process in a consent-enforced sandbox. Every dangerous action requires human approval. The agent never touches your credentials.

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

## How It Works

```
Agent  →  ACP Proxy  →  Policy Engine  →  Human Approval  →  Real MCP Server
                              ↓
                    📱 Telegram / Terminal
```

**Three layers of enforcement:**

1. **Network Isolation** — Agent can only reach the ACP proxy. No direct internet access.
2. **MCP Proxy** — All tool calls intercepted. Policy engine decides: allow, ask, or deny.
3. **Credential Isolation** — API keys stored in ACP's encrypted vault (AES-256-GCM). Agent never sees them.

**Cryptographic guarantees:**

- Every consent decision is signed with Ed25519 keys
- Hash-chained JSONL audit trail (tamper-evident)
- Canonical JSON + nonce-bound consent proofs

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

### Level 2 — Mobile Approvals (2 minutes)

```bash
acp init --channel=telegram
acp secret set OPENAI_API_KEY=sk-...
acp run -- node my_agent.js
```

### Level 3 — Production (10 minutes)

```bash
acp policy apply policies/strict.yml
acp secret set STRIPE_KEY=sk_live_...
sudo acp run --network-isolation -- python production_agent.py
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

Three built-in policies: `default.yml`, `strict.yml`, `development.yml`.

---

## Credential Vault

Secrets encrypted at rest (AES-256-GCM, key derived from Ed25519 private key via HKDF). Never exposed to the agent.

```bash
acp secret set OPENAI_API_KEY=sk-...
acp secret list
acp secret remove OPENAI_API_KEY
```

---

## Comparison

| Feature | ACP | MCP | LangGraph | CrewAI |
|---|:---:|:---:|:---:|:---:|
| Works with any agent/language | ✅ | — | ❌ | ❌ |
| Agent can bypass | **MCP calls: No** | N/A | Yes | Yes |
| Network-level isolation | ✅ | ❌ | ❌ | ❌ |
| Credential isolation | ✅ | ❌ | ❌ | ❌ |
| Mobile approval (Telegram) | ✅ | ❌ | ❌ | ❌ |
| Ed25519 signed consent proofs | ✅ | ❌ | ❌ | ❌ |
| Hash-chained audit trail | ✅ | ❌ | ❌ | ❌ |
| Zero code changes to agent | ✅ | — | ❌ | ❌ |

---

## Works With Everything

```bash
acp run -- openclaw gateway        # OpenClaw
acp run -- python my_agent.py      # Python
acp run -- node agent.js           # Node.js
acp run -- ./my-go-agent           # Go
acp run -- java -jar agent.jar     # Java
```

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We need help with:

- 🔌 Channel adapters (Slack, Discord, Signal, web dashboard)
- 🐧 Sandbox improvements (macOS pf, eBPF, seccomp)
- 🧪 Security review
- 📖 Documentation and tutorials

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Agents use tools. Humans authorize them.**

[⭐ Star on GitHub](https://github.com/o1100/Agent-Consent-Protocol) · [🌐 Website](https://agent2fa.dev) · [🐦 Twitter](https://x.com/Agent2FA)

</div>
