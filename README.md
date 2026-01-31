<div align="center">

# 🔐 Agent Consent Protocol (ACP)

### 2FA for AI Agents

**Human approval before AI agents take consequential actions.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python: 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](sdk/python/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## Quickstart

```bash
pip install acp-sdk
```

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to, subject, body):
    # Won't run until a human approves
    ...
```

**That's it.** When `send_email()` is called, the human sees this in their terminal:

```
════════════════════════════════════════════════════════
  🤖 AGENT CONSENT REQUEST
════════════════════════════════════════════════════════
  Action:   send_email
  Risk:     🔴 HIGH
  Category: 💬 communication
────────────────────────────────────────────────────────
  Send an email to the specified recipient
────────────────────────────────────────────────────────
  Parameters:
    {
      "to": "ceo@company.com",
      "subject": "Quarterly Report",
      "body": "Please find attached..."
    }
════════════════════════════════════════════════════════

  Approve? [y/N]
```

No server. No config. No dependencies. Just a decorator and a prompt.

## Why?

AI agents can now send emails, run shell commands, post tweets, transfer money, and deploy to production. But there's no standard way to make sure a human said "yes" first.

| Without ACP | With ACP |
|---|---|
| Agent hallucinates a $10K purchase → 💸 executes | 📱 Human reviews & denies |
| Prompt injection sends email to CEO → 📧 sends | ✅ Approval prompt first |
| Agent runs `rm -rf /data` → 💀 gone | 🔒 Blocked until approved |

## Progressive Complexity

ACP scales from a terminal prompt to a production-grade consent gateway. **You only add complexity when you need it.**

### Tier 1 — Local Terminal (zero config)

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to, subject, body):
    ...
```

The tool name is auto-classified: `send_email` → communication/high. You can override if you disagree:

```python
@requires_consent("critical", category="financial")
def process_payment(amount, recipient):
    ...
```

### Tier 2 — Mobile Approval (one env var)

Want approvals on your phone instead of the terminal? Set two env vars:

```bash
export ACP_TELEGRAM_TOKEN="your-bot-token"
export ACP_TELEGRAM_CHAT_ID="your-chat-id"
```

**Same code. No changes.** Now consent requests appear as Telegram messages with [✅ Approve] and [❌ Deny] buttons.

```bash
# Only extra dependency for Telegram/gateway mode:
pip install acp-sdk[remote]
```

### Tier 3 — Production Gateway (full security)

For production: Ed25519 cryptographic proofs, hash-chained audit trail, declarative policy engine, SQLite storage.

```bash
# Single command to start the gateway:
npx acp-gateway

# Or Docker:
docker run -p 3000:3000 acp-gateway
```

Then point your SDK at it:

```bash
export ACP_GATEWAY_URL="http://localhost:3000"
```

**Same code. Still no changes.** The decorator detects the env var and routes through the gateway automatically.

## Built-in Risk Classification

ACP knows what common tools do. You don't have to configure anything:

| Tool Name | Auto-Classification |
|---|---|
| `read_file`, `web_search`, `get_weather` | 🟢 data/low |
| `write_file`, `create_event`, `git_commit` | 🟡 data/medium |
| `send_email`, `send_sms` | 🔴 communication/high |
| `send_tweet`, `publish` | 🔴 public/high |
| `execute_shell`, `git_push` | 🔴 system/high |
| `transfer_money`, `deploy_production` | ⛔ financial/critical |

Also works with prefixes: anything starting with `read_` → low, `send_` → high, `delete_` → high, `deploy_` → critical.

Override when you need to:

```python
@requires_consent("low")  # I know this is safe
def send_internal_ping():
    ...
```

## TypeScript SDK

```bash
npm install @acp/sdk
```

```typescript
import { ACPClient } from '@acp/sdk';

const client = new ACPClient({
  gatewayUrl: 'http://localhost:3000',
  agentId: 'my_agent',
});

// Request consent
const consent = await client.requestConsent({
  tool: 'send_email',
  parameters: { to: 'ceo@co.com', subject: 'Report' },
  description: 'Send quarterly report',
  riskLevel: 'high',
});

const response = await consent.waitForDecision();

// Express middleware
import { requireConsent } from '@acp/sdk';

app.post('/api/deploy',
  requireConsent(client, { category: 'system', riskLevel: 'critical' }),
  (req, res) => { /* runs after human approval */ }
);
```

## Gateway API

The gateway is a single-command REST server with:
- **Policy engine** — declarative JSON rules, hot-reloadable
- **Crypto proofs** — Ed25519 signed, nonce-bound, time-limited
- **Audit trail** — hash-chained JSONL, tamper-evident
- **Telegram adapter** — inline button approvals on your phone
- **Webhook adapter** — integrate with anything

```bash
# Start with Telegram:
ACP_TELEGRAM_TOKEN=xxx ACP_TELEGRAM_CHAT_ID=yyy npx acp-gateway

# Or with Docker:
docker run -p 3000:3000 \
  -e ACP_TELEGRAM_TOKEN=xxx \
  -e ACP_TELEGRAM_CHAT_ID=yyy \
  acp-gateway
```

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/consent/request` | Create consent request |
| GET | `/api/v1/consent/:id` | Check status |
| POST | `/api/v1/consent/:id/respond` | Submit human response |
| GET | `/api/v1/consent/:id/proof` | Get signed proof |
| GET | `/api/v1/audit` | Query audit trail |
| GET | `/api/v1/policies` | Get current policy |
| PUT | `/api/v1/policies` | Update policy |

### Policy Engine

```json
{
  "rules": [
    {
      "name": "Auto-approve reads",
      "match": { "risk_level": ["low"] },
      "decision": "auto_approve",
      "priority": 10
    },
    {
      "name": "Always ask for emails",
      "match": { "category": ["communication"], "risk_level": ["high"] },
      "decision": "always_ask",
      "priority": 60
    },
    {
      "name": "Block dangerous commands",
      "match": { "category": ["system"] },
      "decision": "always_ask",
      "constraints": { "blocked_patterns": ["rm -rf", "DROP TABLE"] },
      "priority": 300
    }
  ]
}
```

## How It Works

```
Tier 1 (Local):     Agent → Decorator → Terminal Prompt → Execute/Block
Tier 2 (Telegram):  Agent → Decorator → Telegram Bot → Phone → Execute/Block
Tier 3 (Gateway):   Agent → Decorator → Gateway → Telegram/Webhook → Execute/Block
                                           ↓
                                    Policy Engine
                                    Ed25519 Proofs
                                    Audit Trail
```

The key insight: **the consent check lives outside the agent's trust boundary.** Even in Tier 1, the prompt goes to stderr and reads from stdin — the agent can't intercept or forge it. In Tier 3, it's a separate process with cryptographic proofs.

## Comparison

| Feature | ACP | MCP | LangGraph | AutoGen | CrewAI |
|---|:---:|:---:|:---:|:---:|:---:|
| Human approval flow | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| Zero-config setup | ✅ | — | ❌ | ❌ | ❌ |
| Out-of-band channel | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cryptographic proofs | ✅ | ❌ | ❌ | ❌ | ❌ |
| Policy engine | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| Framework-agnostic | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mobile-friendly | ✅ | ❌ | ❌ | ❌ | ❌ |
| Audit trail | ✅ | ❌ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ❌ | ❌ | ❌ | ❌ |

## Documentation

- [Architecture](docs/architecture.md) — How the pieces fit together
- [Security Model](docs/security-model.md) — Threat model and design
- [Integration Guide](docs/integration-guide.md) — Python, TypeScript, LangChain, MCP
- [Policy Reference](docs/policy-reference.md) — Complete policy configuration
- [Protocol Spec](SPEC.md) — Full protocol specification
- [Quickstart](examples/quickstart.md) — Detailed setup guide

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). We especially need help with:
- 🔌 Channel adapters (Slack, Discord, Signal, web dashboard)
- 🌐 SDKs (Go, Rust, Java)
- 🧪 Testing and security review

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

<div align="center">

**Humans should always have the final say over consequential AI actions.**

⭐ **[Star this repo](https://github.com/agent-consent-protocol/acp)** if you agree.

</div>
