# ACP Quickstart — 3 Minutes to Human-in-the-Loop

Get ACP running and protect your first agent action in under 3 minutes.

## Option 1: Docker (Recommended)

```bash
# Clone the repo
git clone https://github.com/agent-consent-protocol/acp.git
cd acp/examples

# Start the gateway
docker-compose up -d

# Verify it's running
curl http://localhost:3000/health
```

## Option 2: From Source

```bash
# Clone and install
git clone https://github.com/agent-consent-protocol/acp.git
cd acp/gateway
npm install
npm run build

# Start with default policy
ACP_POLICY_PATH=../examples/policies/default.json npm start
```

## Your First Consent Request

### Using curl:

```bash
# Submit a consent request
curl -X POST http://localhost:3000/api/v1/consent/request \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my_agent",
    "action": {
      "tool": "send_email",
      "category": "communication",
      "risk_level": "high",
      "parameters": {
        "to": "boss@company.com",
        "subject": "Weekly Report",
        "body": "Here is the weekly report..."
      },
      "description": "Send weekly report email"
    }
  }'

# Response includes request_id and poll_url
# {"request_id":"cr_...","status":"pending","poll_url":"/api/v1/consent/cr_..."}

# Approve it (simulating human response)
curl -X POST http://localhost:3000/api/v1/consent/cr_YOUR_ID/respond \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "approver_id": "human_1",
    "channel": "api"
  }'
```

### Using Python:

```bash
pip install acp-sdk
```

```python
import asyncio
from acp import ACPClient, requires_consent, ConsentDenied

client = ACPClient(
    gateway_url="http://localhost:3000",
    agent_id="my_agent",
)

@requires_consent(client, category="communication", risk_level="high")
async def send_email(to: str, subject: str, body: str):
    print(f"Sending email to {to}: {subject}")
    return {"sent": True}

async def main():
    try:
        await send_email("boss@company.com", "Report", "Weekly update")
    except ConsentDenied as e:
        print(f"Denied: {e.reason}")
    finally:
        await client.close()

asyncio.run(main())
```

### Using TypeScript:

```bash
npm install @acp/sdk
```

```typescript
import { ACPClient } from '@acp/sdk';

const client = new ACPClient({
  gatewayUrl: 'http://localhost:3000',
  agentId: 'my_agent',
});

const consent = await client.requestConsent({
  tool: 'send_email',
  parameters: { to: 'boss@company.com', subject: 'Report' },
  description: 'Send weekly report',
  category: 'communication',
  riskLevel: 'high',
});

const response = await consent.waitForDecision();
console.log('Decision:', response.decision);
```

## Add Telegram Notifications

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your chat ID (send a message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Set environment variables:

```bash
export ACP_TELEGRAM_TOKEN="your-bot-token"
export ACP_TELEGRAM_CHAT_ID="your-chat-id"
```

4. Restart the gateway. Now consent requests appear as Telegram messages with Approve/Deny buttons!

## Next Steps

- 📖 Read the [full documentation](../docs/)
- 🔧 Configure [policies](../docs/policy-reference.md)
- 🔐 Review the [security model](../docs/security-model.md)
- 🏗️ Check [integration examples](../sdk/python/examples/)
