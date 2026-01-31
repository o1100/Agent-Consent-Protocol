<p align="center">
  <h1 align="center">🔐 Agent Consent Protocol</h1>
  <p align="center"><strong>2FA for AI Agents</strong> — Human authorization before your agent acts</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://pypi.org/project/acp-sdk/"><img src="https://img.shields.io/badge/pypi-acp--sdk-brightgreen.svg" alt="PyPI"></a>
  <a href="https://www.npmjs.com/package/@acp/sdk"><img src="https://img.shields.io/badge/npm-%40acp%2Fsdk-red.svg" alt="npm"></a>
  <a href="SPEC.md"><img src="https://img.shields.io/badge/spec-v0.1.0-orange.svg" alt="Spec"></a>
</p>

---

**The problem:** AI agents can send emails, move money, deploy code, and delete data — but there's no standard way to ensure a human actually approved those actions. Every framework has its own ad-hoc solution (or none at all).

**The solution:** ACP is an open protocol that adds cryptographically verifiable human consent to any AI agent, in any framework, with 2 lines of code.

---

## ⚡ 30-Second Quickstart

```bash
pip install acp-sdk
```

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to, subject, body):
    # ACP prompts the human before this runs
    send_via_smtp(to, subject, body)
```

That's it. When your agent calls `send_email()`, the human sees:

```
═══════════════════════════════════════════════════════════
  🤖 AGENT CONSENT REQUEST
═══════════════════════════════════════════════════════════
  Agent:       default
  Action:      send_email
  Risk:        🔴 HIGH
  Category:    communication
──────────────────────────────────────────────────────────
  Description: Send an email.
  Parameters:  {"to": "ceo@company.com", ...}
═══════════════════════════════════════════════════════════

  [A]pprove or [D]eny?
```

**No config. No server. No dependencies.** Just a terminal prompt.

---

## 🏗️ How It Works

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  AI Agent    │         │  ACP Layer   │         │    Human     │
│              │  call   │              │  ask    │              │
│  "Send email │───────▶ │  Intercept   │────────▶│  Review      │
│   to CEO"    │         │  Classify    │         │  Approve ✅  │
│              │◀─────── │  Verify      │◀────────│  or Deny ❌  │
│  Proceeds    │ result  │  Audit       │ respond │              │
└──────────────┘         └──────────────┘         └──────────────┘
```

1. Agent calls a tool → ACP **intercepts** it
2. Action is **classified** by category and risk level
3. If approval needed → **prompt** is sent to the human
4. Human **reviews** action details and decides
5. If approved → tool executes. If denied → exception raised
6. Everything is **logged** in an audit trail

---

## 📊 Progressive Complexity — Start Simple, Scale Up

### Tier 1: Local Mode (Zero Config)

```python
from acp import requires_consent

@requires_consent("high")
def delete_file(path):
    os.remove(path)
```

- ✅ Terminal prompt
- ✅ Zero dependencies
- ✅ Zero config
- Best for: development, testing, scripts

### Tier 2: Mobile Approvals (One Env Var)

```bash
export ACP_TELEGRAM_TOKEN="your-bot-token"
export ACP_TELEGRAM_CHAT_ID="your-chat-id"
```

Same code. Now approvals go to your phone:

```
🤖 Agent Consent Request
━━━━━━━━━━━━━━━━━━━━
Agent:    My Agent
Action:   delete_file
Risk:     🔴 HIGH

[✅ Approve]  [❌ Deny]
```

- ✅ Mobile approvals via Telegram
- ✅ No server needed
- ✅ Same Python code, just add env vars
- Best for: personal agents, small teams

### Tier 3: Production Gateway (Full Security)

```bash
docker-compose up -d  # Start ACP Gateway
export ACP_GATEWAY_URL="http://localhost:3000"
```

- ✅ Ed25519 signed consent proofs
- ✅ Declarative policy engine
- ✅ Hash-chained audit trail
- ✅ Multiple approval channels
- ✅ Rate limiting, time windows, spending caps
- Best for: production, enterprise, compliance

---

## 🔒 Why Not Just `input("Approve? y/n")`?

| Feature | `input()` | LangGraph `interrupt()` | AutoGen | **ACP** |
|---|---|---|---|---|
| Works across frameworks | ❌ | ❌ LangGraph only | ❌ AutoGen only | **✅ Any** |
| Out-of-band approval | ❌ Same process | ❌ Same process | ❌ Same process | **✅ Separate channel** |
| Mobile/remote approval | ❌ | ❌ | ❌ | **✅ Telegram, webhook** |
| Cryptographic proofs | ❌ | ❌ | ❌ | **✅ Ed25519** |
| Policy engine | ❌ | ❌ | ❌ | **✅ Declarative rules** |
| Audit trail | ❌ | ❌ | ❌ | **✅ Hash-chained** |
| Risk classification | ❌ | ❌ | ❌ | **✅ Auto-classify** |
| Rate limiting | ❌ | ❌ | ❌ | **✅ Per-tool, per-session** |
| Replay prevention | ❌ | ❌ | ❌ | **✅ Nonce-bound** |
| Zero dependencies | ❌ n/a | ❌ langgraph | ❌ autogen | **✅ stdlib only** |

---

## 📦 SDKs

### Python

```bash
pip install acp-sdk              # Zero deps (local mode)
pip install acp-sdk[remote]      # + requests (Telegram/Gateway)
pip install acp-sdk[all]         # + rich + cryptography
```

### TypeScript / Node.js

```bash
npm install @acp/sdk
```

### Gateway Server

```bash
cd gateway && npm install && npm run build && npm start
```

---

## 🧩 Framework Integrations

<details>
<summary><strong>LangChain / LangGraph</strong></summary>

```python
from langchain_core.tools import tool
from acp import ACPClient

client = ACPClient(agent_id="langchain-agent")

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email (requires human approval)."""
    response = client.request_consent(
        tool="send_email",
        description=f"Send email to {to}: {subject}",
        parameters={"to": to, "subject": subject},
        risk_level="high",
    )
    if not response.approved:
        return f"Denied: {response.reason}"
    return actually_send_email(to, subject, body)
```
</details>

<details>
<summary><strong>MCP (Model Context Protocol)</strong></summary>

```typescript
import { ACPClient, acpWrapMCPTools } from '@acp/sdk';

const client = new ACPClient({ agentId: 'mcp-server' });

const safeTools = acpWrapMCPTools(myTools, {
  client,
  toolRiskLevels: { send_email: 'high', read_file: 'low' },
});
```
</details>

<details>
<summary><strong>Express API</strong></summary>

```typescript
import { ACPClient, acpExpressMiddleware } from '@acp/sdk';

app.use('/api/dangerous', acpExpressMiddleware({
  client: new ACPClient({ agentId: 'my-api' }),
  defaultRiskLevel: 'high',
}));
```
</details>

<details>
<summary><strong>AutoGen / CrewAI</strong></summary>

See [Integration Guide](docs/integration-guide.md) for full examples.
</details>

---

## 📜 Policy Engine

Define declarative rules for how your agent handles consent:

```json
{
  "rules": [
    {
      "name": "Auto-approve low-risk reads",
      "match": { "risk_level": ["low"], "category": ["data"] },
      "decision": "auto_approve",
      "priority": 10
    },
    {
      "name": "Block financial actions at night",
      "match": { "category": ["financial"] },
      "conditions": { "time_of_day": { "after": "22:00", "before": "07:00" } },
      "decision": "never_allow",
      "priority": 90
    },
    {
      "name": "Rate limit emails",
      "match": { "category": ["communication"] },
      "decision": "always_ask",
      "constraints": { "rate_limit": { "max_actions": 10, "window_seconds": 3600 } },
      "priority": 50
    }
  ]
}
```

See example policies: [default.json](examples/policies/default.json) | [strict.json](examples/policies/strict.json)

---

## 📖 Documentation

| Document | Description |
|---|---|
| [SPEC.md](SPEC.md) | Protocol specification |
| [Architecture](docs/architecture.md) | System design and data flow |
| [Integration Guide](docs/integration-guide.md) | Framework-specific examples |
| [Quickstart](examples/quickstart.md) | 3-minute getting started guide |

---

## 🗺️ Roadmap

- [x] Python SDK (Tier 1 + 2 + 3)
- [x] TypeScript SDK
- [x] Gateway server (Express + SQLite)
- [x] Telegram approval channel
- [x] Webhook approval channel
- [x] Policy engine
- [x] Ed25519 consent proofs
- [x] Hash-chained audit trail
- [ ] Web dashboard for approvals
- [ ] Slack/Discord approval channels
- [ ] Multi-approver workflows
- [ ] Go SDK
- [ ] Rust SDK
- [ ] OIDC/OAuth integration
- [ ] MCP server reference implementation

---

## 🤝 Contributing

We welcome contributions! ACP is designed to be an open standard.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

### Areas We Need Help

- **More approval channels** — Slack, Discord, WhatsApp, push notifications
- **More framework integrations** — Haystack, DSPy, Semantic Kernel
- **Testing** — Unit tests, integration tests, security audits
- **Documentation** — Tutorials, guides, translations

---

## 📄 License

Apache 2.0 — see [LICENSE](LICENSE).

**The protocol specification (SPEC.md) is freely implementable by anyone.** We want ACP to be a standard, not a product.

---

<p align="center">
  <sub>Built because AI agents should ask before they act.</sub>
</p>
