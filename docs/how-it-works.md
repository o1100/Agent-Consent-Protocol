# How ACP Works

## The Layers

ACP enforces consent through multiple layers. Not all layers are active by default — read this section to understand what's enforced in your setup.

### Layer 1: MCP Proxy (Always Active)

This is the core of ACP. The MCP proxy intercepts every MCP tool call and routes it through the consent gate. This layer is **always active** when you run `acp run`.

### Layer 2: Docker Containment (Recommended — `--contained`)

```
┌─────────────────────────────────────────┐
│         Docker Container                │
│         (--internal network)            │
│                                         │
│  ┌──────────┐         ┌──────────────┐  │
│  │  Agent   │────────►│ ACP Proxy    │──┼──► Internet
│  │ Process  │         │ (bridge)     │  │
│  └──────────┘         └──────────────┘  │
│       │                                  │
│       ╳ ──── All other traffic DROPPED   │
│       ╳ ──── No access to ~/.acp/        │
│                                         │
└─────────────────────────────────────────┘
```

**When enabled** (with `acp run --contained`), the agent runs inside a Docker container with an `--internal` network. The agent can only communicate with the ACP proxy. All other outbound traffic is blocked. The agent has no access to `~/.acp/` (keys, config, vault).

**When not enabled** (the default), there is no network enforcement. The agent can make direct HTTP requests, bypassing ACP entirely. In this mode, ACP only catches actions the agent routes through MCP.

**Docker containment provides:**
- **Network isolation:** `--internal` network has no outbound gateway
- **Key/config isolation:** `~/.acp/` is not mounted in the container
- **Shell/HTTP coverage:** Even non-MCP actions (shell commands, direct HTTP) are blocked at the network level

### Layer 3: MCP Proxy (Detail)

```
Agent                    ACP Proxy                 Real MCP Server
  │                         │                           │
  │── tools/call ──────────►│                           │
  │   "send_email"          │                           │
  │                         │── Policy check ──►        │
  │                         │   Rule: ask, level: high  │
  │                         │                           │
  │                         │── Consent request ──► 📱  │
  │                         │   (Telegram/terminal)     │
  │                         │                           │
  │                         │◄── Human: Approve ────    │
  │                         │                           │
  │                         │── tools/call ────────────►│
  │                         │   (with credentials)      │
  │                         │                           │
  │                         │◄── result ───────────────│
  │◄── result ─────────────│                           │
```

The ACP proxy implements the MCP protocol. The agent connects to it thinking it's a normal MCP server. The proxy:

1. **Intercepts** all `tools/call` requests
2. **Classifies** the tool call (category + risk level)
3. **Evaluates** the policy (allow / ask / deny)
4. **Asks** the human if needed (via configured channel)
5. **Injects** credentials from the vault (if approved)
6. **Forwards** to the real MCP server
7. **Returns** the response to the agent
8. **Logs** everything to the audit trail

### Layer 4: Credential Isolation

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│  Agent   │     │  ACP Vault   │     │  APIs    │
│          │     │              │     │          │
│ No keys  │     │ SMTP_PASS=** │     │ Needs    │
│ No tokens│     │ API_KEY=**   │     │ auth     │
│ No creds │     │ STRIPE=**    │     │          │
└──────────┘     └──────────────┘     └──────────┘
                        │
                        ▼
                 Injected ONLY after
                 human approval
```

The agent process never has access to API keys, tokens, or passwords. These are stored in ACP's encrypted vault. When a human approves a tool call, ACP injects the required credentials into the request before forwarding it to the real MCP server.

Even if the agent is compromised by prompt injection, it cannot extract credentials because they're never in its environment.

## The Complete Flow

```
1. You run:  acp run --contained -- python my_agent.py
   (or without --contained for proxy-only mode)

2. ACP starts:
   - Loads config from ~/.acp/config.yml
   - Loads policy from ~/.acp/policy.yml
   - Starts MCP proxy on 127.0.0.1:8443
   - (If --contained) builds and starts Docker container with --internal network

3. ACP spawns the agent:
   - ACP_PROXY_URL=http://127.0.0.1:8443 injected
   - Vault secrets stripped from environment
   - (If --contained) process runs inside Docker container with no outbound network
   - (If --contained) ~/.acp/ is NOT mounted — agent cannot access keys or config

4. Agent makes a tool call:
   - Agent's MCP client connects to ACP_PROXY_URL
   - Sends: tools/call { name: "send_email", arguments: {...} }

5. ACP intercepts:
   - Classifies: send_email → communication/high
   - Policy check: rule says "ask", level "high"
   - Sends consent request to your phone (Telegram)

6. You approve or deny:
   - ✅ Approve → ACP injects SMTP credentials, forwards to real MCP server
   - ❌ Deny → ACP returns error to agent

7. Everything is logged:
   - Tool call, classification, policy decision, human decision
   - Hash-chained for tamper detection
   - Ed25519 signed for non-repudiation
```

## Why This Architecture?

**Software trust is not enough.** If consent checks run inside the agent's process, they can be bypassed — through prompt injection, code execution, or framework bugs.

ACP puts the consent layer **outside** the agent:
- Different process (can't be manipulated by the agent)
- Different key material (agent can't sign its own approvals)
- Different network (when isolation is enabled — agent can't reach the internet)

This is the same principle as hardware security modules (HSMs) in banking: the approval mechanism must be physically separate from the system being controlled.

## Important Limitations

1. **MCP-only interception (default mode).** In default mode, ACP only intercepts MCP `tools/call` requests. If your agent makes direct HTTP calls, uses `child_process.exec()`, or interacts with the world through non-MCP interfaces, those actions bypass ACP. **In contained mode (`--contained`),** this is mitigated: Docker `--internal` networking blocks all outbound traffic regardless of method.

2. **Network isolation is not default.** Without `--contained`, the agent can make arbitrary network requests. ACP only catches what goes through the MCP proxy. Use `acp run --contained` for full enforcement.

3. **Same-user process model (default mode).** In default mode, the agent runs as the same OS user as ACP and could theoretically read ACP's config, keys, and vault files. **In contained mode,** `~/.acp/` is not mounted in the container, so the agent cannot access these files.

See [THREAT-MODEL.md](../THREAT-MODEL.md) for the full analysis and [SECURITY.md](../SECURITY.md) for known gaps.
