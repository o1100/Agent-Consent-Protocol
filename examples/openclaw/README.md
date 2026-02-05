# OpenClaw + ACP — Full Setup Guide

Run [OpenClaw](https://github.com/o1100/OpenClaw) inside ACP's consent-gated Docker container. Every shell command and HTTP request requires human approval via Telegram.

## Prerequisites

- Node.js 22+
- Docker Desktop running
- An OpenClaw `.openclaw/` config directory (with your `config.yml` and API keys configured)
- A Telegram bot token and chat ID (for mobile approvals)

## Quick Start

### 1. Install ACP

```bash
npm install -g agent-2fa
```

### 2. Initialize ACP with Telegram

```bash
acp init --channel=telegram
```

This creates `~/.acp/` with your config and a default policy. You'll be prompted for your Telegram bot token and chat ID.

### 3. Set up a workspace

The workspace is the directory that gets mounted into the Docker container at `/workspace`. OpenClaw needs to be installed inside this workspace so the container can find it.

**Automated:**

```bash
./setup.sh ./my-openclaw-workspace
```

**Manual:**

```bash
mkdir -p ./my-openclaw-workspace
cd ./my-openclaw-workspace
npm init -y
npm install openclaw@latest
```

### 4. Copy your OpenClaw config into the workspace

```bash
cp -r ~/.openclaw ./my-openclaw-workspace/.openclaw
```

Make sure the `workspace` path in your OpenClaw `config.yml` is set to `/workspace` (the container mount point), not a host path.

### 5. Run OpenClaw through ACP

```bash
acp contain \
  --workspace=./my-openclaw-workspace \
  --env=ANTHROPIC_API_KEY \
  --env=OPENAI_API_KEY \
  --channel=telegram \
  -- node /workspace/node_modules/openclaw/openclaw.mjs gateway
```

The `--env` flags forward your host API keys into the container. Add or remove keys as needed for your setup.

## Multi-Instance Support

To run multiple ACP instances (e.g., multiple bots), use `--config` to give each its own config directory:

```bash
# Bot 1
acp init --config=~/.acp-bot1 --channel=telegram
acp contain --config=~/.acp-bot1 \
  --workspace=./bot1-workspace \
  --env=ANTHROPIC_API_KEY \
  -- node /workspace/node_modules/openclaw/openclaw.mjs gateway

# Bot 2
acp init --config=~/.acp-bot2 --channel=telegram
acp contain --config=~/.acp-bot2 \
  --workspace=./bot2-workspace \
  --env=ANTHROPIC_API_KEY \
  -- node /workspace/node_modules/openclaw/openclaw.mjs gateway
```

ACP auto-detects port conflicts. If the default ports (8443, 8444) are already in use by another instance, it will automatically find the next available ports. You can also set ports explicitly:

```bash
acp contain --consent-port=9443 --http-proxy-port=9444 ...
```

## What Happens

1. ACP creates an isolated Docker container on the `acp-jail` network
2. OpenClaw runs inside the container with no direct internet access
3. **Layer 1** — Shell wrappers intercept commands like `gh`, `git`, `curl`
4. **Layer 2** — HTTP proxy intercepts all outbound HTTP/HTTPS traffic
5. Every intercepted action is sent to your Telegram for approval
6. Approved actions execute; denied actions fail with a clear message

## Customizing the Policy

Edit `~/.acp/policy.yml` (or the policy in your `--config` dir) to control what requires approval:

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
