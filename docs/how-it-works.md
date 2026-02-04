# How ACP Works

## The 2FA Analogy

Passwords alone weren't enough — a stolen password meant full access. 2FA added a second, out-of-band factor (your phone). ACP applies the same principle to AI agents.

| Auth World | Agent World |
|---|---|
| Password | Agent has system access |
| Stolen password | Prompt injection |
| 2FA push notification | Consent request to phone |
| Risk-based auth | Policy: only ask for risky actions |

## Two Layers of Interception

ACP intercepts agent actions at two levels inside a Docker container:

### Layer 1: Shell Wrappers

When the agent runs a command like `gh commit -m "msg"`:

1. The shell wrapper for `gh` intercepts the call
2. Wrapper POSTs to ACP's consent server (`http://host:8443/consent`)
3. ACP evaluates the policy
4. If `ask`: sends push notification to your phone, waits for response
5. If approved: wrapper executes the real `gh` binary
6. If denied: wrapper exits with an error

**Why it's needed:** Network-level interception can't distinguish `gh commit` from `gh pr list`. You need command-level context for granular policies.

### Layer 2: HTTP Forward Proxy

Any HTTP/HTTPS traffic from inside the container is forced through ACP's HTTP proxy (`http://host:8444`):

1. Proxy extracts the destination host/method
2. ACP evaluates the policy
3. If approved: proxy forwards the request
4. If denied: proxy returns 403

**Why it's needed:** Shell wrappers only cover listed commands. If the agent uses Python's `requests` library directly, Layer 2 catches it.

### Defense in Depth

```
Agent runs command
    |
Layer 1: Shell wrapper intercepts → consent gate → approve/deny
    | (if approved, or no wrapper for this command)
Command executes inside container
    |
Layer 2: Any network traffic → HTTP proxy → consent gate → approve/deny
    | (if approved)
Traffic reaches the internet
```

When a command is approved at Layer 1, its network traffic auto-passes Layer 2 (via a short-lived approval token) to avoid double-prompting.

## Architecture

```
HOST MACHINE
+----------------------------------------------------------+
|                                                          |
|  ACP Process                                             |
|  +----------------------------------------------------+  |
|  |  Consent Gate <-- Policy (YAML rules)              |  |
|  |       |                                            |  |
|  |       +-- Channel (Telegram push notifications)    |  |
|  |       +-- Audit Log (append-only JSONL)            |  |
|  |                                                    |  |
|  |  Listening on host:                                |  |
|  |    :8443 -- Consent server (shell wrapper callbacks)|  |
|  |    :8444 -- HTTP forward proxy                     |  |
|  +----------------------------------------------------+  |
|                                                          |
+---------------------------+------------------------------+
                            | Docker internal network
+---------------------------v------------------------------+
|                                                          |
|  AGENT CONTAINER                                         |
|  --read-only --cap-drop=ALL --no-new-privileges          |
|                                                          |
|  /workspace (mounted, writable)                          |
|  /usr/local/bin/acp-wrappers/ (prepended to PATH)        |
|    gh -> calls back to host:8443 for approval            |
|    git -> calls back to host:8443 for approval           |
|    curl -> calls back to host:8443 for approval          |
|    rm -> calls back to host:8443 for approval            |
|                                                          |
|  HTTP_PROXY=http://host:8444                             |
|  HTTPS_PROXY=http://host:8444                            |
|                                                          |
+----------------------------------------------------------+
```

## Why Containers?

Shell wrappers alone are trivially bypassable — the agent can download a new binary, use raw syscalls, or modify PATH. Network proxies alone only work if the agent respects `HTTP_PROXY` env vars.

Inside a Docker container with `--read-only`, `--cap-drop=ALL`, and `--internal` network:
- Shell wrappers can't be bypassed (read-only filesystem, no internet to download tools)
- Network proxy can't be bypassed (all traffic must go through the container's network)
- Host is protected (agent can't see host filesystem, processes, or network)

## Platform Differences

| | Linux | macOS/Windows |
|---|---|---|
| Docker network | `--internal` (no gateway) | Bridge + proxy env vars |
| Isolation strength | Kernel-enforced | Proxy-enforced (weaker) |
| Future improvement | N/A | Docker Desktop microVM sandboxes |

On Linux, Docker `--internal` networks have no outbound gateway at the kernel level. The agent literally cannot reach the internet.

On macOS/Windows (Docker Desktop), `--internal` networks behave differently due to the VM layer. ACP uses a bridge network with proxy env vars and DNS blocking instead. This is weaker — a determined agent could bypass proxy env vars with direct TCP connections.

Docker Desktop's microVM-based sandboxes would provide strong isolation on macOS/Windows, but they currently only support a hardcoded list of agents (Claude, Gemini) and don't allow custom agents. When Docker adds support for arbitrary agents, ACP will integrate with microVM sandboxes for full cross-platform isolation.

## Core Abstractions

ACP has 4 core abstractions:

1. **ConsentGate** — one function: `(action) => Promise<Verdict>`
2. **Policy** — YAML rules, top-to-bottom, first match wins
3. **Channel** — push notification adapter (Telegram, Webhook, Terminal)
4. **AuditLog** — append-only JSONL file

## Important Limitations

1. **Docker is required.** Without Docker, there is no isolation. ACP will not run without it.
2. **Shell wrappers only cover listed commands.** The `wrap` list in your policy determines which commands are intercepted at Layer 1. Unlisted commands execute freely but hit Layer 2 if they make network requests.
3. **Programmatic file deletion is a gap.** A long-running Python process calling `os.remove()` bypasses shell wrappers. The read-only container filesystem mitigates this for system files, but the mounted workspace is writable.
4. **macOS/Windows isolation is weaker.** See Platform Differences above.
