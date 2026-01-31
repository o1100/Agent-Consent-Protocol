# ACP Integration Guide

## Quick Reference

| Framework | SDK | Integration Pattern |
|---|---|---|
| Any (REST API) | curl/httpx/fetch | Direct HTTP calls |
| Python (any) | `acp-sdk` | `@requires_consent` decorator |
| LangChain/LangGraph | `acp-sdk[langchain]` | `LangChainACPMiddleware` |
| Express.js | `@acp/sdk` | `requireConsent()` middleware |
| MCP Servers | `@acp/sdk` | `wrapMCPTool()` wrapper |
| OpenClaw | `acp-sdk` | Decorator or direct client |

## Python Integration

### Install

```bash
pip install acp-sdk
# With crypto verification:
pip install acp-sdk[crypto]
# With LangChain support:
pip install acp-sdk[langchain]
```

### Decorator Pattern (Recommended)

The simplest way to protect functions:

```python
from acp import ACPClient, requires_consent

client = ACPClient(
    gateway_url="http://localhost:3000",
    agent_id="my_agent",
)

@requires_consent(client, category="communication", risk_level="high")
async def send_email(to: str, subject: str, body: str):
    """This function requires human approval before execution."""
    return await email_service.send(to, subject, body)
```

### Direct Client Pattern

For more control over the consent flow:

```python
from acp import ACPClient, ConsentDenied, ConsentTimeout

client = ACPClient(gateway_url="http://localhost:3000", agent_id="my_agent")

consent = await client.request_consent(
    tool="deploy",
    parameters={"service": "api", "version": "2.0"},
    description="Deploy API v2.0 to production",
    category="system",
    risk_level="critical",
    context={"conversation_summary": "User asked for production deploy"},
)

try:
    response = await consent.wait_for_decision()
    # Execute the action with approved (possibly modified) params
    params = response.apply_modifications({"service": "api", "version": "2.0"})
    await deploy(**params)
except ConsentDenied as e:
    print(f"Denied: {e.reason}")
except ConsentTimeout:
    print("No response in time")
```

### LangChain Integration

```python
from langchain_core.tools import tool
from acp import ACPClient, LangChainACPMiddleware

client = ACPClient(gateway_url="http://localhost:3000", agent_id="agent")
middleware = LangChainACPMiddleware(client)

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email."""
    return f"Sent to {to}"

# Wrap the tool
protected = middleware.wrap_tool(send_email, category="communication", risk_level="high")

# Use in your agent
# agent = create_react_agent(llm, [protected])
```

## TypeScript Integration

### Install

```bash
npm install @acp/sdk
```

### Express Middleware

```typescript
import express from 'express';
import { ACPClient, requireConsent } from '@acp/sdk';

const client = new ACPClient({
  gatewayUrl: 'http://localhost:3000',
  agentId: 'my_agent',
});

const app = express();

app.post('/api/deploy',
  requireConsent(client, { category: 'system', riskLevel: 'critical' }),
  (req, res) => {
    // Only executes after human approval
    res.json({ deployed: true });
  }
);
```

### MCP Tool Wrapper

```typescript
import { ACPClient, wrapMCPTool } from '@acp/sdk';

const client = new ACPClient({
  gatewayUrl: 'http://localhost:3000',
  agentId: 'mcp_agent',
});

const handler = wrapMCPTool(client, {
  tool: 'send_email',
  category: 'communication',
  riskLevel: 'high',
  handler: async (args) => {
    return await sendEmail(args.to, args.subject, args.body);
  },
});
```

### Function Wrapper

```typescript
const client = new ACPClient({
  gatewayUrl: 'http://localhost:3000',
  agentId: 'my_agent',
});

const protectedSendTweet = client.wrap(
  async (text: string) => twitter.post(text),
  { tool: 'send_tweet', category: 'public', riskLevel: 'high' }
);

await protectedSendTweet('Hello world!');
```

## REST API (Any Language)

For languages without an SDK, use the REST API directly:

```bash
# 1. Request consent
curl -X POST http://localhost:3000/api/v1/consent/request \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my_agent",
    "action": {
      "tool": "send_email",
      "category": "communication",
      "risk_level": "high",
      "parameters": {"to": "user@example.com"},
      "description": "Send email"
    }
  }'

# 2. Poll for decision
curl http://localhost:3000/api/v1/consent/REQUEST_ID

# 3. Get proof
curl http://localhost:3000/api/v1/consent/REQUEST_ID/proof
```
