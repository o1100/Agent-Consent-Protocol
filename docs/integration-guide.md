# Integration Guide

ACP wraps processes — not frameworks. Any agent that runs as a command can be sandboxed with `acp contain`.

> **How it works:** ACP intercepts all shell commands (via wrappers on port :8443) and all HTTP/HTTPS requests (via proxy on port :8444). The agent runs inside a Docker container with no direct internet access. Every action requires human consent.

## OpenClaw

```bash
# Configure ACP + OpenClaw in one step
acp init --channel=telegram
# Says "y" to OpenClaw setup, provides messaging bot token + API keys

# Start OpenClaw inside ACP containment (one command)
acp start openclaw
# Auto-creates ~/openclaw-workspace, installs openclaw, runs gateway in Docker
```

The `acp init` wizard generates both `~/.acp/config.yml` (ACP consent config) and `~/.openclaw/openclaw.json` (OpenClaw config with correct schema). The `acp start openclaw` command handles workspace setup and runs the gateway inside a Docker container with full ACP containment — no separate install step needed.

See [examples/openclaw/](../examples/openclaw/) for the full setup guide.

## Custom Agents (Any Language)

ACP works with any agent that runs as a command:

```bash
# Node.js
acp contain -- node my_agent.js

# Go
acp contain -- ./my-go-agent

# Rust
acp contain -- ./my-rust-agent

# Java
acp contain -- java -jar agent.jar
```

Inside the container, all HTTP traffic is routed through ACP's proxy via `HTTP_PROXY` and `HTTPS_PROXY` environment variables. Shell commands (curl, wget, git, etc.) are intercepted by shell wrappers that call back to ACP's consent server at `ACP_CONSENT_URL`.

## Docker

For manual Docker deployments, use Docker Compose:

```bash
# Copy the example
cp examples/docker-compose.yml .

# Start ACP on the host
acp init --channel=telegram

# Run your agent in a container
acp contain -- python my_agent.py
```

See [examples/docker-compose.yml](../examples/docker-compose.yml) for a manual compose configuration.

## Environment Variables

ACP injects these into the agent process:

| Variable | Value | Description |
|---|---|---|
| `HTTP_PROXY` | `http://<host>:8444` | Forces HTTP traffic through ACP proxy |
| `HTTPS_PROXY` | `http://<host>:8444` | Forces HTTPS traffic through ACP proxy |
| `ACP_CONSENT_URL` | `http://<host>:8443` | Shell wrapper callback URL |
| `ACP_SANDBOX` | `1` | Indicates running inside ACP |
| `ACP_CONTAINED` | `1` | Set when running in Docker contained mode |
| `ACP_VERSION` | `0.3.0` | ACP version |

## Container Security

When you run `acp contain`, the agent is launched inside a Docker container with strong isolation:

- **Read-only filesystem** (`--read-only`) with a tmpfs at `/tmp`
- **All capabilities dropped** (`--cap-drop=ALL`)
- **No privilege escalation** (`--no-new-privileges`)
- **Internal network only** — no outbound internet access
- All traffic must go through ACP's consent gate (shell wrappers on :8443, HTTP proxy on :8444)
- `~/.acp/` is not mounted in the container, so the agent cannot read ACP's keys or config
- The `ACP_CONTAINED=1` environment variable is set so your agent can detect it is running in contained mode

Your agent code requires no changes — environment variables are injected automatically. The container provides a strong isolation boundary enforced by Docker.
