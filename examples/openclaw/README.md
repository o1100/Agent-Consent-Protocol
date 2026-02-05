# OpenClaw + ACP — Full Setup Guide

Run [OpenClaw](https://github.com/o1100/OpenClaw) inside ACP's consent-gated Docker container. Every shell command and HTTP request requires human approval via Telegram.

## Prerequisites

- Node.js 22+
- Docker Desktop running
- At least 512MB RAM (1GB recommended — OpenClaw gateway uses ~128MB, ACP adds ~64MB)
- Two Telegram bot tokens from @BotFather:
  - **Consent bot** — ACP sends approve/deny prompts here
  - **Messaging bot** — OpenClaw receives and responds to your messages here

## Quick Start

### 1. Install ACP and OpenClaw

```bash
# ACP
npm install -g agent-consent-protocol

# OpenClaw
curl -fsSL https://openclaw.ai/install.sh | bash
```

### 2. Initialize ACP with Telegram

```bash
acp init --channel=telegram
```

The wizard will:
1. Ask for your **consent bot token** and **chat ID** (creates `~/.acp/config.yml`)
2. Verify the consent bot by sending a test message
3. Ask if you want to configure the **OpenClaw messaging bot**
4. If yes, collect the messaging bot token and API keys (creates `~/.openclaw/openclaw.json`)

The OpenClaw config is written with the correct schema:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "BRAVE_API_KEY": "BSA..."
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123:abc...",
      "dmPolicy": "allowlist",
      "allowFrom": ["your-chat-id"]
    }
  }
}
```

### 3. Start the OpenClaw messaging bot

```bash
openclaw gateway
```

This starts the gateway that listens for your Telegram messages and responds via the messaging bot. You should now be able to message your bot on Telegram and get replies.

### 4. (Optional) Run OpenClaw through ACP containment

To run the OpenClaw gateway inside ACP's Docker sandbox with consent gating:

```bash
# Set up a workspace with openclaw installed
./setup.sh ./my-openclaw-workspace

# Run contained
acp contain \
  --workspace=./my-openclaw-workspace \
  --env=ANTHROPIC_API_KEY \
  --env=OPENAI_API_KEY \
  --channel=telegram \
  -- node /workspace/node_modules/.bin/openclaw gateway
```

The `--env` flags forward your host API keys into the container.

## Multi-Instance Support

To run multiple ACP instances (e.g., multiple bots), use `--config` to give each its own config directory:

```bash
# Bot 1
acp init --config=~/.acp-bot1 --channel=telegram
acp contain --config=~/.acp-bot1 \
  --workspace=./bot1-workspace \
  --env=ANTHROPIC_API_KEY \
  -- node /workspace/node_modules/.bin/openclaw gateway

# Bot 2
acp init --config=~/.acp-bot2 --channel=telegram
acp contain --config=~/.acp-bot2 \
  --workspace=./bot2-workspace \
  --env=ANTHROPIC_API_KEY \
  -- node /workspace/node_modules/.bin/openclaw gateway
```

ACP auto-detects port conflicts and finds the next available ports.

## What Happens

1. ACP creates an isolated Docker container on the `acp-jail` network
2. OpenClaw runs inside the container with no direct internet access
3. **Layer 1** — Shell wrappers intercept commands like `gh`, `git`, `curl`
4. **Layer 2** — HTTP proxy intercepts all outbound HTTP/HTTPS traffic
5. Every intercepted action is sent to your Telegram for approval
6. Approved actions execute; denied actions fail with a clear message

## Customizing the Policy

Edit `~/.acp/policy.yml` to control what requires approval:

```yaml
default: ask

wrap:
  - gh
  - git
  - curl
  - node
  - npm

rules:
  # Auto-allow Anthropic API calls
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
  # Always ask for git pushes
  - match: { name: "git", args: "push*" }
    action: ask
```

See the [Policy Reference](../../docs/policy-reference.md) for full syntax.

## Troubleshooting

### OpenClaw config validation errors

If `openclaw gateway` shows `Unrecognized keys`, your `~/.openclaw/openclaw.json` has the wrong schema. Re-run `acp init --channel=telegram` and say "y" to the OpenClaw setup, or manually fix the config to match the schema above.

### Gateway uses too much memory

On VMs with less than 512MB RAM, the OpenClaw gateway (~128MB) plus ACP can cause heavy swapping. Add swap space:

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Messaging bot doesn't respond

1. Check the gateway is running: `ps aux | grep openclaw`
2. Check logs: `cat /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log`
3. Verify the bot token: `curl https://api.telegram.org/bot<TOKEN>/getMe`
4. Make sure your chat ID is in `allowFrom` in `~/.openclaw/openclaw.json`
