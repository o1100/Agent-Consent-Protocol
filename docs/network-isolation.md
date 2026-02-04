# Network Isolation

ACP enforces network isolation by running the agent inside a Docker container. The container can only reach ACP's consent server and HTTP proxy on the host.

## How It Works

### Linux
Docker `--internal` network: no outbound gateway exists at the kernel level. The agent cannot make any external connections. Only the host gateway IP is reachable (where ACP listens).

### macOS / Windows
Docker Desktop runs containers in a VM. ACP uses a bridge network with:
- `HTTP_PROXY` / `HTTPS_PROXY` environment variables
- `--dns=127.0.0.1` to break DNS resolution
- `--add-host=acp-host:host-gateway` for container-to-host communication

This is proxy-enforced isolation — weaker than Linux because a determined agent could make direct TCP connections to raw IPs, bypassing the proxy.

## Future: Docker Desktop microVM Sandboxes

Docker Desktop offers microVM-based sandboxes on macOS/Windows that provide strong isolation similar to Linux `--internal` networks. However, `docker sandbox run` currently only supports a hardcoded list of agents (Claude, Gemini) and doesn't allow custom agents. When Docker adds support for arbitrary agents, ACP will integrate with microVM sandboxes for full cross-platform isolation.

## Container Hardening

Every ACP container runs with:
- `--read-only` filesystem (can't install bypass tools)
- `--cap-drop=ALL` (no Linux capabilities)
- `--no-new-privileges` (no privilege escalation)
- `--tmpfs /tmp` and `--tmpfs /home` (temporary writable areas)
- `--pids-limit=256` (prevent fork bombs)
- `--memory=2g` (prevent memory exhaustion)

## Checking Isolation

The agent container receives environment variables indicating its isolation status:
- `ACP_CONTAINED=1` — running in Docker container
- `ACP_SANDBOX=1` — running under ACP control

## Recommendations

| Environment | Recommendation |
|---|---|
| Linux servers | `acp contain` (full kernel-enforced isolation) |
| macOS development | `acp contain` (proxy-enforced, functional but weaker) |
| Windows development | `acp contain` (proxy-enforced, functional but weaker) |
| Production (any OS) | Linux server with `acp contain` for strongest guarantees |
