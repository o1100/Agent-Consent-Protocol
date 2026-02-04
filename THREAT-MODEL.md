# Threat Model

## What ACP Protects Against

| Threat | Protection | Status |
|--------|-----------|--------|
| Agent running banned shell commands | Layer 1: shell wrappers intercept and gate via consent | Working |
| Agent making unauthorized HTTP requests | Layer 2: HTTP forward proxy intercepts all outbound traffic | Working |
| Agent bypassing shell wrappers | Container: read-only filesystem, no internet, can't install tools | Working |
| Agent bypassing HTTP proxy | Container: Docker `--internal` network has no gateway (Linux) | Working (Linux) |
| Agent reading ACP keys/config | Container: `~/.acp/` not mounted in container | Working |
| Agent escalating privileges | Container: `--cap-drop=ALL`, `--no-new-privileges` | Working |
| Prompt injection causing harmful actions | Human sees actual action before it executes via phone notification | Working |
| Agent installing bypass tools | Container: `--read-only` filesystem, no package managers work | Working |

## What ACP Does NOT Protect Against (Yet)

| Threat | Why | Planned Fix |
|--------|-----|-------------|
| macOS/Windows proxy bypass | Bridge network + env vars (not kernel-enforced) | Docker Desktop microVM sandboxes when they support custom agents |
| Programmatic file deletion in workspace | `os.remove()` inside running interpreter bypasses shell wrapper | FUSE overlay on workspace (v2) |
| Kernel exploits / container escape | Shared kernel in standard Docker containers | gVisor runtime or Firecracker microVMs |
| Compromised host OS | ACP runs in userspace | Out of scope |

## Assumptions

1. **The human approver is trusted.** ACP ensures humans decide, not that humans decide correctly.
2. **The approval channel is secure.** Telegram uses HTTPS. Terminal mode assumes local access is trusted.
3. **Docker is the enforcement boundary.** Without Docker, there is no isolation. ACP requires Docker.
4. **Two-layer defense in depth.** Layer 1 (shell wrappers) provides semantic context. Layer 2 (HTTP proxy) is the catch-all. Both together provide robust coverage.

## Attacker Models

### Malicious Agent (Primary Threat)
An AI agent that actively tries to bypass consent.

- **Shell wrappers can't be removed** — read-only filesystem
- **New tools can't be installed** — no internet access, no package managers
- **Direct HTTP requests caught** — HTTP proxy intercepts all outbound traffic
- **Container can't be escaped** — no capabilities, no privilege escalation

### Prompt Injection
External input tricks the agent into performing unintended actions.

- Layer 1 shows the actual command to the human (not what the agent claims)
- Human makes the decision based on what they see

### Local Attacker (Same Machine)
- Agent runs in Docker container, cannot access host files or processes
- ACP keys/config not mounted in container

## Platform Security Comparison

| | Linux | macOS/Windows |
|---|---|---|
| Network isolation | Kernel-enforced (`--internal`) | Proxy-enforced (env vars) |
| Container hardening | Full | Full |
| Shell wrappers | Protected by read-only FS | Protected by read-only FS |
| Known gap | None | Agent could bypass proxy with raw TCP to IPs |
| Future fix | N/A | Docker Desktop microVM sandboxes |

## Current Maturity

```
concept -> working prototype -> [You are here: v0.3] -> formal audit -> hardened v1
```
