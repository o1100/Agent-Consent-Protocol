# ACP Quickstart

## Tier 1 — Local Terminal (30 seconds)

```bash
pip install acp-sdk
```

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to, subject, body):
    print(f"Sending email to {to}")

send_email("ceo@company.com", "Report", "Here it is.")
# → Terminal prompt: Approve? [y/N]
```

Done. That's the whole integration.

## Tier 2 — Telegram Approval (2 minutes)

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → get your token
2. Send any message to your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to get your chat ID
3. Set env vars:

```bash
pip install acp-sdk[remote]
export ACP_TELEGRAM_TOKEN="123456:ABC-DEF..."
export ACP_TELEGRAM_CHAT_ID="987654321"
```

4. Run the same code. Consent requests now appear on your phone with [✅ Approve] [❌ Deny] buttons.

## Tier 3 — Production Gateway (5 minutes)

```bash
# Start the gateway (one command)
npx acp-gateway

# Or with Docker:
docker run -p 3000:3000 \
  -e ACP_TELEGRAM_TOKEN=your-token \
  -e ACP_TELEGRAM_CHAT_ID=your-chat-id \
  acp-gateway
```

Point your Python code at it:

```bash
export ACP_GATEWAY_URL="http://localhost:3000"
```

Same Python code — no changes. Now you get:
- Ed25519 cryptographic proofs
- Hash-chained audit trail
- Declarative policy engine
- SQLite persistence
- Multiple channel adapters

## Configuration

All via environment variables — no config files needed:

| Variable | Tier | Description |
|---|---|---|
| *(none)* | 1 | Terminal prompt |
| `ACP_TELEGRAM_TOKEN` | 2 | Telegram bot token |
| `ACP_TELEGRAM_CHAT_ID` | 2 | Telegram chat ID |
| `ACP_GATEWAY_URL` | 3 | Gateway server URL |
| `ACP_GATEWAY_API_KEY` | 3 | Gateway authentication key |
| `ACP_AGENT_ID` | Any | Agent identifier (default: "default") |
| `ACP_AGENT_NAME` | Any | Agent display name |
