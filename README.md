<div align="center">

# 🔐 Agent Consent Protocol

### MCP is how agents use tools. ACP is how humans control agents.

**One command. Any agent. Unbypassable.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![npm: @acp/cli](https://img.shields.io/badge/npm-%40acp%2Fcli-red.svg)](cli/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## The Problem

AI agents can send emails, run shell commands, transfer money, and deploy to production — but there's no universal way to ensure a human said "yes" first. Existing frameworks bury consent in application code where agents can bypass it. **The agent holds the keys, the credentials, and the power.**

## The Solution

ACP wraps any agent process in a consent-enforced sandbox. The agent never touches your credentials. Every dangerous action requires human approval. It's like Docker for agent authorization.

```bash
acp run -- python my_agent.py
```

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  🔐 ACP Consent Request                            │
│                                                     │
│  Agent:   my_agent.py                               │
│  Action:  send_email                                │
│  Risk:    🔴 HIGH                                   │
│                                                     │
│  To:      boss@company.com                          │
│  Subject: "Quarterly Report"                        │
│  Body:    "Please find attached..."                 │
│                                                     │
│  [✅ Approve]  [❌ Deny]                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The agent doesn't know ACP exists. It thinks it's talking to a normal MCP server. But ACP is intercepting every tool call, checking policy, and asking you first.

---

## 30-Second Quickstart

```bash
npm install -g @acp/cli

# Initialize with terminal prompts (simplest)
acp init --channel=prompt

# Run any agent through ACP
acp run -- python my_agent.py
```

That's it. Every tool call now requires your approval.

---

## How It Works

```
┌──────────────┐     ┌──────────────────────────────────────────┐     ┌──────────────┐
│              │     │              ACP Sandbox                  │     │              │
│   Your       │     │  ┌─────────┐    ┌─────────┐  ┌────────┐ │     │  Real MCP    │
│   Agent      ├────►│  │  MCP    ├───►│ Policy  ├─►│ Human  │ │────►│  Servers     │
│              │     │  │  Proxy  │    │ Engine  │  │ Approve│ │     │              │
│  (any lang)  │     │  └─────────┘    └─────────┘  └────────┘ │     │  (tools,     │
│              │     │                                          │     │   APIs)      │
└──────────────┘     │  🔒 Network isolated                    │     └──────────────┘
                     │  🔑 Credentials held by ACP             │
                     │  📋 Everything audited                  │
                     └──────────────────────────────────────────┘
                                        │
                                        ▼
                               ┌─────────────────┐
                               │  📱 Your Phone   │
                               │  (Telegram/SMS)  │
                               │  or Terminal     │
                               └─────────────────┘
```

**Three layers of enforcement:**

1. **Network Isolation** — The agent can only reach the ACP proxy. No direct internet access. Can't call APIs behind your back.
2. **MCP Proxy** — All tool calls are intercepted. ACP speaks MCP, so agents don't know it's there. Policy engine decides: allow, ask, or deny.
3. **Credential Isolation** — API keys, tokens, and secrets are stored in ACP's encrypted vault. The agent never sees them. ACP injects credentials only after human approval.

---

## Progressive Complexity

### Level 1 — Try It (30 seconds)

Terminal prompts, no accounts needed:

```bash
npm install -g @acp/cli
acp init --channel=prompt
acp run -- python my_agent.py
```

### Level 2 — Mobile Approvals (2 minutes)

Get consent requests on your phone via Telegram:

```bash
acp init --channel=telegram
# Enter your Telegram bot token and chat ID

acp secret set OPENAI_API_KEY=sk-...
acp run -- node my_agent.js
```

Now approval requests appear as Telegram messages with inline ✅/❌ buttons.

### Level 3 — Production (10 minutes)

Docker-based network isolation, YAML policies, encrypted credential vault:

```bash
# Apply a strict policy
acp policy apply policies/strict.yml

# Store all credentials in the vault
acp secret set SMTP_PASSWORD=xxx
acp secret set STRIPE_KEY=sk_live_xxx
acp secret set AWS_SECRET_ACCESS_KEY=xxx

# Run with full network isolation (Linux, requires root)
sudo acp run --network-isolation -- python production_agent.py
```

Or use Docker for cross-platform isolation:

```bash
docker compose up  # See examples/docker-compose.yml
```

---

## Policy Engine

Policies are simple YAML. No code required.

```yaml
# policies/default.yml
version: "1"
default_action: ask

rules:
  # Reading is always safe
  - match: { category: read }
    action: allow

  # Shell commands always need approval
  - match: { tool: exec }
    action: ask
    level: high

  # Sending messages needs approval
  - match: { category: communication }
    action: ask
    level: high

  # Financial actions: critical security
  - match: { category: financial }
    action: ask
    level: critical
    timeout: 300  # 5 min to decide, then auto-deny

  # Safety net: rate limit everything
  - match: { tool: "*" }
    rate_limit: 20/minute
```

Three built-in policies:

| Policy | Description | Use case |
|---|---|---|
| `default.yml` | Ask for dangerous, allow reads | Day-to-day use |
| `strict.yml` | Ask for everything | Production, sensitive work |
| `development.yml` | Allow most, ask for dangerous | Local development |

```bash
acp policy apply policies/strict.yml
```

---

## Credential Vault

Secrets are encrypted at rest and never exposed to the agent process:

```bash
# Store secrets
acp secret set OPENAI_API_KEY=sk-...
acp secret set SMTP_PASSWORD=hunter2
acp secret set STRIPE_KEY=sk_live_...

# List stored secrets (values hidden)
acp secret list
# OPENAI_API_KEY  ••••••••
# SMTP_PASSWORD   ••••••••
# STRIPE_KEY      ••••••••
```

When the agent calls a tool that needs credentials, ACP injects them **after** human approval — the agent process never has them in its environment.

---

## Comparison

| Feature | ACP | MCP alone | OAuth | LangGraph interrupts | CrewAI |
|---|:---:|:---:|:---:|:---:|:---:|
| Human approval for tool calls | ✅ | ❌ | ❌ | ⚠️ in-process | ⚠️ in-process |
| Works with any agent/language | ✅ | — | — | ❌ Python only | ❌ Python only |
| Network-level isolation | ✅ | ❌ | ❌ | ❌ | ❌ |
| Credential isolation | ✅ | ❌ | ⚠️ scoped | ❌ | ❌ |
| Out-of-band approval (mobile) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cryptographic audit trail | ✅ | ❌ | ❌ | ❌ | ❌ |
| YAML policy engine | ✅ | ❌ | ❌ | ❌ | ❌ |
| Zero code changes to agent | ✅ | — | ❌ | ❌ | ❌ |
| One command to start | ✅ | — | ❌ | ❌ | ❌ |

**Key difference:** Other frameworks put consent checks *inside* the agent's process, where they can be bypassed. ACP enforces consent *outside* the agent at the network level.

---

## Works With Everything

ACP wraps processes, not frameworks. If it runs as a command, ACP can sandbox it:

```bash
# OpenClaw
acp run -- openclaw gateway

# Python agents
acp run -- python my_agent.py

# LangChain
acp run -- python langchain_agent.py

# AutoGen
acp run -- python autogen_script.py

# CrewAI
acp run -- python crew.py

# Node.js agents
acp run -- node agent.js

# Any language, any framework
acp run -- ./my-go-agent
acp run -- java -jar agent.jar
```

See [examples/](examples/) for integration guides.

---

## CLI Reference

```
acp init [--channel=prompt|telegram|webhook]
    Interactive setup wizard. Generates keys, creates config.

acp run [--network-isolation] [--policy=<file>] -- <command>
    Run an agent inside the ACP sandbox.

acp secret set KEY=VALUE
acp secret list
acp secret remove KEY
    Manage the encrypted credential vault.

acp policy apply <file>
acp policy show
    Load and inspect YAML policies.

acp status
    Show running ACP sessions and proxy status.
```

---

## Audit Trail

Every action is logged to a hash-chained JSONL file. Tamper with one entry and the chain breaks.

```bash
# View recent audit events
cat ~/.acp/audit.jsonl | jq .

# Each entry includes:
# - What tool was called, with what parameters
# - What the policy engine decided
# - Whether a human approved or denied
# - Cryptographic hash linking to the previous entry
# - Ed25519 signature of the approval
```

---

## Documentation

- [How It Works](docs/how-it-works.md) — Architecture deep dive
- [Network Isolation](docs/network-isolation.md) — Sandbox internals
- [Policy Reference](docs/policy-reference.md) — Complete YAML reference
- [Integration Guide](docs/integration-guide.md) — OpenClaw, LangChain, etc.
- [Cloud Deployment](docs/cloud-deployment.md) — Terraform for AWS/Azure
- [Protocol Spec](SPEC.md) — Full protocol specification

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We especially need help with:

- 🔌 **Channel adapters** — Slack, Discord, Signal, web dashboard
- 🐧 **Sandbox improvements** — macOS pf rules, eBPF, seccomp
- 🧪 **Security review** — audit the isolation model
- 📖 **Documentation** — tutorials, videos, blog posts

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Agents use tools. Humans authorize them. That's the deal.**

⭐ **[Star this repo](https://github.com/agent-consent-protocol/acp)** if you agree.

</div>
