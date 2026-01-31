# How ACP Works

## The Three Layers

ACP enforces consent through three independent layers. Even if one layer is bypassed, the others still protect you.

### Layer 1: Network Isolation

```
┌─────────────────────────────────────────┐
│           Network Namespace             │
│                                         │
│  ┌──────────┐         ┌──────────────┐  │
│  │  Agent   │────────►│ ACP Proxy    │──┼──► Internet
│  │ Process  │         │ (127.0.0.1)  │  │
│  └──────────┘         └──────────────┘  │
│       │                                  │
│       ╳ ──── All other traffic DROPPED   │
│                                         │
└─────────────────────────────────────────┘
```

The agent runs in a restricted network environment. It can only communicate with the ACP proxy on localhost. All other outbound traffic is blocked — the agent cannot call APIs directly, cannot exfiltrate data, and cannot bypass ACP.

**Implementation varies by platform:**
- **Linux (root):** Network namespaces + iptables rules
- **Docker:** Container in an isolated network, only ACP has internet
- **Fallback:** Proxy-only mode with a warning (no network enforcement)

### Layer 2: MCP Proxy

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

### Layer 3: Credential Isolation

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
1. You run:  acp run -- python my_agent.py

2. ACP starts:
   - Loads config from ~/.acp/config.yml
   - Loads policy from ~/.acp/policy.yml
   - Starts MCP proxy on 127.0.0.1:8443
   - (Optionally) sets up network isolation

3. ACP spawns the agent:
   - ACP_PROXY_URL=http://127.0.0.1:8443 injected
   - Vault secrets stripped from environment
   - Process runs inside network sandbox (if enabled)

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
- Different network (agent can't reach the internet)
- Different key material (agent can't sign its own approvals)

This is the same principle as hardware security modules (HSMs) in banking: the approval mechanism must be physically separate from the system being controlled.
