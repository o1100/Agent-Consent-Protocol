# ACP Integration Guide

## Python — Zero Dependencies

### Install

```bash
pip install acp-sdk
```

That's it. No server to run, no config files to create.

### Basic Decorator

```python
from acp import requires_consent

@requires_consent("high")
def send_email(to: str, subject: str, body: str):
    """Send an email."""
    ...
```

The decorator intercepts the call, shows a terminal prompt (or Telegram message, or gateway request depending on env vars), and either runs the function or raises `ConsentDeniedError`.

### Risk Levels

```python
@requires_consent("low")      # 🟢 Quick prompt
@requires_consent("medium")   # 🟡 Standard prompt
@requires_consent("high")     # 🔴 Prominent warning
@requires_consent("critical") # ⛔ Big scary warning
```

### Category Override

Category is auto-detected from the function name, but you can override:

```python
@requires_consent("critical", category="financial")
def process_payment(amount, recipient):
    ...
```

### Error Handling

```python
from acp import requires_consent, ConsentDeniedError

@requires_consent("high")
def send_email(to, subject, body):
    ...

try:
    send_email("user@example.com", "Hello", "World")
except ConsentDeniedError as e:
    print(f"Human said no: {e}")
```

### Direct Client (Advanced)

```python
from acp import ACPClient

client = ACPClient(agent_id="my_agent")
# Mode auto-detected: local → telegram → gateway

response = client.request_consent(
    tool="deploy_production",
    parameters={"service": "api", "version": "2.0"},
    description="Deploy API v2.0 to production",
    risk_level="critical",
    category="system",
)

if response.approved:
    deploy(service="api", version="2.0")
else:
    print(f"Denied: {response.reason}")
```

### Upgrading to Telegram (Tier 2)

```bash
pip install acp-sdk[remote]
export ACP_TELEGRAM_TOKEN="your-bot-token"
export ACP_TELEGRAM_CHAT_ID="your-chat-id"
```

No code changes needed. Same decorator, now routes to Telegram.

### Upgrading to Gateway (Tier 3)

```bash
npx acp-gateway  # Start the gateway
export ACP_GATEWAY_URL="http://localhost:3000"
```

No code changes needed. Same decorator, now routes through the gateway.

### LangChain Integration

```python
from langchain_core.tools import tool
from acp.middleware import LangChainACPMiddleware

middleware = LangChainACPMiddleware()

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email."""
    return f"Sent to {to}"

protected_email = middleware.wrap_tool(send_email)
# Auto-classified: send_email → communication/high
```

## TypeScript

```bash
npm install @acp/sdk
```

Requires a running gateway (Tier 3):

```typescript
import { ACPClient } from '@acp/sdk';

const client = new ACPClient({
  gatewayUrl: 'http://localhost:3000',
  agentId: 'my_agent',
});

const consent = await client.requestConsent({
  tool: 'send_email',
  parameters: { to: 'user@example.com' },
  description: 'Send email',
  riskLevel: 'high',
});

const response = await consent.waitForDecision();
```

### Express Middleware

```typescript
import { requireConsent } from '@acp/sdk';

app.post('/api/deploy',
  requireConsent(client, { category: 'system', riskLevel: 'critical' }),
  (req, res) => {
    // Only runs after human approval
    res.json({ deployed: true });
  }
);
```

### MCP Tool Wrapper

```typescript
import { wrapMCPTool } from '@acp/sdk';

const handler = wrapMCPTool(client, {
  tool: 'send_email',
  category: 'communication',
  riskLevel: 'high',
  handler: async (args) => sendEmail(args.to, args.subject, args.body),
});
```

## REST API (Any Language)

```bash
# Request consent
curl -X POST http://localhost:3000/api/v1/consent/request \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"my_agent","action":{"tool":"send_email","category":"communication","risk_level":"high","parameters":{"to":"user@co.com"},"description":"Send email"}}'

# Poll for decision
curl http://localhost:3000/api/v1/consent/REQUEST_ID

# Get proof
curl http://localhost:3000/api/v1/consent/REQUEST_ID/proof
```
