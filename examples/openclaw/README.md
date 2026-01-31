# OpenClaw + ACP

Run OpenClaw with ACP consent enforcement:

```bash
# Initialize ACP
acp init --channel=telegram

# Store your secrets in the ACP vault
acp secret set OPENAI_API_KEY=sk-...
acp secret set TELEGRAM_TOKEN=xxx

# Run OpenClaw through ACP
acp run -- openclaw gateway
```

OpenClaw will run normally, but every MCP tool call goes through ACP first. The agent can't access your API keys directly — they're in ACP's vault.

## With Docker

```yaml
services:
  acp:
    image: ghcr.io/o1100/acp:latest
    environment:
      - ACP_CHANNEL=telegram
      - ACP_TELEGRAM_TOKEN=${TELEGRAM_TOKEN}
      - ACP_TELEGRAM_CHAT_ID=${CHAT_ID}
    networks: [isolated, internet]

  openclaw:
    image: ghcr.io/o1100/openclaw:latest
    environment:
      - ACP_PROXY_URL=http://acp:8443
    networks: [isolated]  # No direct internet

networks:
  isolated:
    internal: true
  internet:
```
