# OpenClaw + ACP — Full Setup Guide

Run [OpenClaw](https://github.com/o1100/OpenClaw) with ACP's consent gating. Every sensitive shell command and HTTP request requires human approval via Telegram.

## Prerequisites

- Node.js 22+
- Docker (Linux) or Docker Desktop (macOS/Windows)
- At least 2GB RAM (or 2GB swap) — OpenClaw gateway uses ~500MB heap
- Two Telegram bot tokens from @BotFather:
  - **Consent bot** — ACP sends approve/deny prompts here
  - **Messaging bot** — OpenClaw receives and responds to your messages here

## Setup

### 1. Install ACP

```bash
# From npm
npm install -g agent-consent-protocol

# Or from source
git clone --branch v0.3.0 https://github.com/o1100/Agent-Consent-Protocol.git
cd Agent-Consent-Protocol/cli
npm install && npm run build && sudo npm link
```

### 2. Configure ACP + OpenClaw

```bash
acp init --channel=telegram
```

The wizard will:
1. Ask for your **consent bot token** and **chat ID** (creates `~/.acp/config.yml`)
2. Verify the consent bot by sending a test message
3. Ask if you want to configure the **OpenClaw messaging bot**
4. If yes, collect the messaging bot token and API keys (creates `~/.openclaw/openclaw.json`)

The generated OpenClaw config uses the correct schema:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123:abc...",
      "dmPolicy": "allowlist",
      "allowFrom": ["your-chat-id"]
    }
  },
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "BRAVE_API_KEY": "BSA..."
  }
}
```

### 3. Start OpenClaw (one command)

```bash
acp start openclaw
```

This single command:
- Creates `~/openclaw-workspace` (if it doesn't exist)
- Installs `openclaw@latest` via npm
- Copies `~/.openclaw/openclaw.json` into the workspace
- Runs the OpenClaw gateway inside a Docker container with full ACP containment

To use a custom workspace directory:

```bash
acp start openclaw --workspace=/path/to/my-workspace
```

### 4. Verify

```bash
# Check the container is running (in another terminal)
docker ps

# Check audit log
cat ~/.acp/audit.jsonl

# Message your OpenClaw bot on Telegram — it should respond
# The response goes through ACP's consent gate
```

To stop: press **Ctrl+C** in the terminal where `acp start openclaw` is running.

## How ACP Containment Works

When you run `acp start openclaw`:

1. ACP creates an isolated Docker container on the `acp-jail` network
2. The OpenClaw gateway runs inside the container with no direct internet access
3. **Layer 1** — Shell wrappers intercept commands like `gh`, `git`, `curl`
4. **Layer 2** — HTTP proxy intercepts all outbound HTTP/HTTPS traffic
5. Every intercepted action is sent to your Telegram for approval
6. Approved actions execute; denied actions fail with a clear message

The `templates/openclaw.yml` policy auto-allows Telegram API, LLM providers, and common safe APIs. Everything else requires approval.

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

If the gateway shows `Unrecognized keys`, your `~/.openclaw/openclaw.json` has the wrong schema. Re-run `acp init --channel=telegram` and say "y" to the OpenClaw setup, or manually fix the config to match the schema above.

### Gateway uses too much memory

The OpenClaw gateway needs ~500MB heap. On VMs with less than 2GB RAM, add swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Messaging bot doesn't respond

1. Check the container is running: `docker ps`
2. Check ACP audit log: `cat ~/.acp/audit.jsonl`
3. Verify the bot token: `curl https://api.telegram.org/bot<TOKEN>/getMe`
4. Make sure your chat ID is in `allowFrom` in `~/.openclaw/openclaw.json`
