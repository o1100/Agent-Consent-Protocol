# Agent Consent Protocol (ACP) — Specification v0.3.0

**Version:** 0.3.0
**Status:** Working prototype
**License:** Apache 2.0

## 1. Overview

The Agent Consent Protocol (ACP) is an open standard for human authorization of AI agent actions. In v0.3.0, ACP enforces consent gating through network-layer mediation on Linux VMs, targeting OpenClaw deployments.

ACP provides:

1. **HTTP Consent Proxy** — Forward proxy on loopback that gates outbound HTTP/HTTPS
2. **Network Isolation** — Per-UID nftables egress rules (fail-closed)
3. **Consent Gates** — Human approval via Telegram, terminal, or webhook
4. **Policy Engine** — YAML-based rules: allow, ask, deny
5. **Audit Trail** — Append-only JSONL logging of all consent decisions

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│                    ACP (root)                         │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ HTTP     │  │ Policy   │  │ Consent  │           │
│  │ Proxy    │──│ Engine   │──│ Gate     │           │
│  │ (loopback)  │          │  │          │           │
│  └────┬─────┘  └──────────┘  └────┬─────┘           │
│       │                           │                   │
│       │                     ┌─────┴─────┐            │
│       │                     │ Channel   │            │
│       │                     │ Adapter   │            │
│       │                     └─────┬─────┘            │
│  ┌────┴─────┐                     │       ┌────────┐ │
│  │ nftables │                     │       │ Audit  │ │
│  │ Egress   │                     │       │ Logger │ │
│  └────┬─────┘                     │       └────────┘ │
│       │                           │                   │
└───────┼───────────────────────────┼───────────────────┘
        │                           │
        ▼                           ▼
   ┌─────────┐               ┌───────────┐
   │  Agent  │               │  Human    │
   │ Process │               │  (Telegram│
   │ (uid)   │               │  /Terminal)│
   └─────────┘               └───────────┘
```

### 2.1 HTTP Consent Proxy

ACP runs a forward HTTP proxy on `127.0.0.1:<port>`. The agent process is configured to route HTTP/HTTPS traffic through this proxy via environment variables (`HTTP_PROXY`, `HTTPS_PROXY`) and Node.js fetch patching.

The proxy:

- Accepts HTTP CONNECT (HTTPS) and direct HTTP requests
- Builds an action record for each request (host, method, URL)
- Evaluates the action against the policy engine
- Forwards approved requests to the internet
- Rejects denied requests

### 2.2 Network Isolation Model

v0.3.0 uses per-UID nftables rules on Linux:

| Method | Scope |
|---|---|
| nftables egress rules (`meta skuid`) | All outbound TCP from the agent's Linux user |

The rules:

1. Allow TCP to `127.0.0.1:<proxy_port>` (ACP proxy)
2. Allow UDP/TCP to system DNS servers on port 53
3. Reject all other outbound traffic from the agent UID

This is fail-closed: if ACP is not running, the agent cannot make outbound connections.

**Platform scope:** Linux only in v0.3.0. Requires root/sudo for nftables rule installation.

### 2.3 Known Gaps

**Agent-native tools bypass ACP.** If the agent has built-in tools that execute server-side (e.g., OpenClaw's `web_search`, `web_fetch`), those actions are invisible to ACP. The local process sends an API call to the agent's backend, and the backend performs the web request. ACP sees the API connection but cannot gate individual tool actions.

This is a fundamental limitation of network-layer enforcement for agents with server-side tool execution.

### 2.4 Consent Request Flow

```
1. Agent process makes outbound HTTP/HTTPS request
2. Request hits ACP proxy (via env vars + nftables constraint)
3. Proxy builds action record (kind=http, host, method, url)
4. Policy engine evaluates:
   a. "allow" → forward immediately
   b. "deny"  → reject immediately
   c. "ask"   → proceed to step 5
5. Channel adapter delivers to human (Telegram/terminal/webhook)
6. Human reviews and decides (approve/deny)
7. If approved: request forwarded to destination
8. If denied: connection rejected
9. Audit logger records the action and verdict
```

Failures in the consent path default to deny.

## 3. Terminology

| Term | Definition |
|---|---|
| **Agent** | Any process running as the constrained Linux user |
| **Consent Gate** | `(action: Action) => Promise<Verdict>` — the decision function |
| **Policy** | YAML rules that control consent behavior |
| **Channel** | Interface to deliver consent requests (Telegram, terminal, webhook) |
| **Approver** | Human who reviews and approves/denies requests |
| **Verdict** | The gate's decision: `allow` or `deny`, with a reason string |
| **Action** | Description of what the agent wants to do (kind, host, method) |

## 4. Core Types

### 4.1 Action

```typescript
type ActionKind = 'shell' | 'http';

interface Action {
  name: string;
  args?: string;
  meta: {
    kind: ActionKind;
    host?: string;
    method?: string;
    port?: number;
  };
}
```

In VM mode, most actions are `kind: http`. The `shell` kind is used in legacy Docker mode only.

### 4.2 Verdict

```typescript
interface Verdict {
  decision: 'allow' | 'deny';
  reason: string;
}
```

### 4.3 Audit Entry

```typescript
interface AuditEntry {
  timestamp: string;   // ISO-8601
  action: Action;
  verdict: Verdict;
}
```

## 5. Policy Specification

### 5.1 Policy File Format

```yaml
default: ask

rules:
  - match:
      kind: http
      host: "*.example.com"
      method: "GET"
    action: allow
    timeout: 120
```

### 5.2 Match Fields (VM mode)

| Field | Type | Description |
|---|---|---|
| `kind` | string | `http` (primary in VM mode) |
| `host` | string/glob | HTTP host (e.g., `"*.anthropic.com"`) |
| `method` | string | HTTP method (`GET`, `POST`, etc.) |

Legacy Docker mode also supports `name` (command name) and `args` (argument glob).

### 5.3 Actions

| Action | Behavior |
|---|---|
| `allow` | Forward immediately, no consent needed |
| `ask` | Request human approval via configured channel |
| `deny` | Block immediately |

### 5.4 Rule Evaluation

1. Rules are evaluated in order (top to bottom)
2. First matching rule wins
3. If no rule matches, `default` action applies
4. Glob matching: `*` matches any characters, `?` matches one character

### 5.5 Host Approval Cache

When a human approves an HTTP request, ACP caches the host approval for a short TTL (default 180 seconds, configurable via `ACP_HTTP_HOST_APPROVAL_TTL_SEC`). The `www.` twin is also cached (e.g., approving `example.com` also caches `www.example.com`).

## 6. Audit Trail

### 6.1 Format

Append-only JSONL (one JSON object per line), stored at `~/.acp/audit.jsonl`.

### 6.2 Entry Schema

```json
{
  "timestamp": "2026-01-15T10:30:00.000Z",
  "action": {
    "name": "CONNECT",
    "meta": {
      "kind": "http",
      "host": "api.example.com",
      "method": "CONNECT",
      "port": 443
    }
  },
  "verdict": {
    "decision": "allow",
    "reason": "Approved by human"
  }
}
```

No hash chaining or cryptographic proofs in v0.3.0. The audit log is a simple append-only JSONL file.

## 7. Configuration

### 7.1 Config File

Stored at `~/.acp/config.yml`:

```yaml
channel: telegram

telegram:
  bot_token: "<token>"
  chat_id: "<chat_id>"
```

### 7.2 Data Locations

Default paths when running `--openclaw-user=openclaw`:

| Path | Purpose |
|---|---|
| `/home/openclaw/.acp/config.yml` | ACP config |
| `/home/openclaw/.acp/policy.yml` | Policy rules |
| `/home/openclaw/.acp/audit.jsonl` | Audit log |

## 8. Security Requirements

1. **Process separation**: ACP MUST run as root; agent MUST run as non-root user
2. **Network enforcement**: Agent UID outbound TCP MUST be restricted to ACP proxy via nftables
3. **Fail-closed**: Default decision path MUST deny on failure
4. **Out-of-band channel**: Approval channel MUST be unreachable by the agent process
5. **Append-only audit**: All consent decisions MUST be logged

### 8.1 Not Implemented in v0.3.0

The following were described in earlier spec drafts but are **not part of v0.3.0**:

- Credential vault (encrypted secret storage)
- Cryptographic proofs (Ed25519-signed approvals)
- Hash-chained audit trail
- MCP protocol interception
- Cross-platform support (macOS, Windows)
- Rate limiting
- Risk level classifications
- Nonce-bound approvals

---

*For implementation details, see the [CLI source](cli/) and [architecture docs](docs/how-it-works.md).*
