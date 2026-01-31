# Agent Consent Protocol (ACP) — Specification v0.2

**Version:** 0.2.0 (Draft)
**Status:** Draft RFC
**License:** Apache 2.0

## 1. Overview

The Agent Consent Protocol (ACP) is an open standard for human authorization of AI agent actions, implemented as a transparent MCP proxy that sandboxes any agent process.

ACP provides:

1. **MCP Proxy** — Sits between agent and real MCP servers, intercepting all tool calls
2. **Network Isolation** — Agent can only reach the ACP proxy, not the internet
3. **Credential Vault** — Secrets stored encrypted, injected only after approval
4. **Consent Gates** — Human approval via Telegram, terminal, or webhook
5. **Policy Engine** — YAML-based rules: allow, ask, deny, rate-limit
6. **Cryptographic Proofs** — Ed25519-signed, nonce-bound, time-limited approvals
7. **Audit Trail** — Hash-chained JSONL, tamper-evident

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ACP Process                          │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ MCP      │  │ Policy   │  │ Consent  │  │ Cred   │ │
│  │ Proxy    │──│ Engine   │──│ Gate     │──│ Vault  │ │
│  │ Server   │  │          │  │          │  │        │ │
│  └────┬─────┘  └──────────┘  └────┬─────┘  └────┬───┘ │
│       │                           │              │     │
│       │                     ┌─────┴─────┐        │     │
│       │                     │ Channel   │        │     │
│       │                     │ Adapter   │        │     │
│       │                     └─────┬─────┘        │     │
│  ┌────┴─────┐                     │         ┌────┴───┐ │
│  │ Sandbox  │                     │         │ Audit  │ │
│  │ Manager  │                     │         │ Logger │ │
│  └────┬─────┘                     │         └────────┘ │
│       │                           │                     │
└───────┼───────────────────────────┼─────────────────────┘
        │                           │
        ▼                           ▼
   ┌─────────┐               ┌───────────┐
   │  Agent  │               │  Human    │
   │ Process │               │  (Phone/  │
   │         │               │  Terminal)│
   └─────────┘               └───────────┘
```

### 2.1 MCP Proxy

The ACP proxy implements the MCP (Model Context Protocol) interface. The agent connects to it as if it were a normal MCP server. The proxy:

- Accepts MCP JSON-RPC connections (stdio or HTTP/SSE)
- Intercepts `tools/call` requests
- Forwards `tools/list` with tool metadata
- Passes through `resources/*` and `prompts/*` unchanged (or with policy checks)
- Connects to one or more upstream MCP servers to fulfill approved requests

### 2.2 Network Isolation Model

The sandbox restricts the agent process's network access:

| Platform | Method | Isolation Level |
|---|---|---|
| Linux (root) | Network namespaces + iptables | Full — only loopback to ACP proxy |
| Linux (rootless) | LD_PRELOAD socket interception | Partial — software enforcement |
| Docker | Container networking | Full — agent in isolated network |
| macOS (root) | pf firewall rules | Full — only loopback to ACP proxy |
| Fallback | Environment variable only | None — proxy-only mode with warning |

In full isolation mode:
1. ACP creates a network namespace (or equivalent)
2. The agent process runs inside the namespace
3. Only traffic to `127.0.0.1:<acp_port>` is allowed
4. All other outbound traffic is dropped
5. DNS is not available inside the sandbox

### 2.3 Credential Vault

```
~/.acp/vault.json (encrypted)
{
  "version": 1,
  "encryption": "aes-256-gcm",
  "salt": "<hex>",
  "iv": "<hex>",
  "data": "<encrypted JSON>",
  "tag": "<hex>"
}
```

The vault stores key-value pairs encrypted with a key derived from the ACP master key (Ed25519 private key → HKDF → AES-256-GCM).

Credentials are:
- **Never** exposed in the agent's environment
- **Never** passed on the command line
- **Only** injected into tool call parameters after human approval
- **Logged** in the audit trail (key name only, never value)

### 2.4 Consent Request Flow

```
1. Agent calls tools/call via MCP protocol
2. ACP proxy intercepts the request
3. Policy engine evaluates:
   a. "allow" → forward to upstream MCP server immediately
   b. "deny"  → return error to agent immediately
   c. "ask"   → proceed to step 4
4. Consent gate creates a ConsentRequest
5. Channel adapter delivers to human (Telegram/terminal/webhook)
6. Human reviews and decides (approve/deny/modify)
7. If approved:
   a. Credential vault injects required secrets
   b. Request forwarded to upstream MCP server
   c. Response returned to agent
8. If denied:
   a. Error response returned to agent
9. Audit logger records the complete event
```

## 3. Terminology

| Term | Definition |
|---|---|
| **Agent** | Any process that makes MCP tool calls |
| **ACP Proxy** | MCP-compatible server that intercepts and gates tool calls |
| **Sandbox** | Network-isolated environment the agent runs in |
| **Credential Vault** | Encrypted store of secrets, managed by ACP |
| **Consent Gate** | Logic that determines if human approval is needed |
| **Channel Adapter** | Interface to deliver consent requests (Telegram, terminal, etc.) |
| **Policy** | YAML rules that control consent behavior |
| **Approver** | Human who reviews and approves/denies requests |
| **Consent Proof** | Ed25519-signed attestation of a human's decision |

## 4. Message Types

### 4.1 Consent Request

```json
{
  "type": "consent_request",
  "version": "0.2.0",
  "id": "cr_<unique_id>",
  "timestamp": "ISO-8601",
  "expires_at": "ISO-8601",
  "agent": {
    "id": "string",
    "name": "string",
    "command": "string"
  },
  "action": {
    "tool": "string",
    "server": "string",
    "category": "string",
    "risk_level": "low | medium | high | critical",
    "parameters": {},
    "description": "string"
  },
  "policy": {
    "rule_id": "string",
    "rule_name": "string",
    "required_level": "string"
  },
  "nonce": "n_<uuid>"
}
```

### 4.2 Consent Response

```json
{
  "type": "consent_response",
  "version": "0.2.0",
  "request_id": "cr_<id>",
  "timestamp": "ISO-8601",
  "decision": "approved | denied | approved_with_modifications",
  "approver": {
    "id": "string",
    "channel": "telegram | terminal | webhook"
  },
  "modifications": {} | null,
  "conditions": {
    "valid_until": "ISO-8601",
    "single_use": true
  },
  "nonce": "n_<uuid>",
  "proof": {
    "algorithm": "Ed25519",
    "public_key": "hex",
    "signature": "hex",
    "signed_payload_hash": "sha256:<hex>"
  }
}
```

## 5. Policy Specification

### 5.1 Policy File Format

```yaml
version: "1"
default_action: ask | allow | deny

rules:
  - match:
      tool: "string | glob"        # Tool name or pattern
      category: "string"           # Action category
      server: "string"             # MCP server name
      args:                        # Argument matching
        key: "value | glob"
    action: allow | ask | deny
    level: low | medium | high | critical  # For "ask" actions
    timeout: 300                   # Seconds before auto-deny
    rate_limit: "20/minute"        # Rate limiting
    conditions:
      time_of_day:
        after: "09:00"
        before: "17:00"
        timezone: "UTC"
```

### 5.2 Rule Evaluation

1. Rules are evaluated in order (top to bottom)
2. First matching rule wins
3. If no rule matches, `default_action` applies
4. Rate limits are checked after rule matching

### 5.3 Match Criteria

- `tool`: Exact name or glob pattern (`send_*`, `*_email`, `*`)
- `category`: One of `read`, `write`, `communication`, `financial`, `system`, `public`, `physical`
- `server`: Name of the upstream MCP server
- `args`: Key-value pairs that must match in the tool call parameters (supports glob values)

### 5.4 Actions

| Action | Behavior |
|---|---|
| `allow` | Forward immediately, no consent needed |
| `ask` | Request human approval via configured channel |
| `deny` | Block immediately, return error to agent |

### 5.5 Built-in Classifications

ACP auto-classifies common tool names:

| Pattern | Category | Default Risk |
|---|---|---|
| `read_*`, `get_*`, `list_*`, `search_*` | read | low |
| `write_*`, `create_*`, `update_*` | write | medium |
| `send_*`, `email_*`, `message_*` | communication | high |
| `delete_*`, `remove_*`, `drop_*` | system | high |
| `deploy_*`, `exec*`, `shell_*` | system | high |
| `transfer_*`, `pay_*`, `charge_*` | financial | critical |
| `publish_*`, `post_*`, `tweet_*` | public | high |

## 6. Cryptographic Proofs

### 6.1 Key Generation

ACP generates an Ed25519 key pair during `acp init`:
- Private key stored in `~/.acp/keys/private.key` (encrypted)
- Public key stored in `~/.acp/keys/public.key`

### 6.2 Signing Payload

The signed payload is a canonical JSON object with sorted keys:

```json
{
  "action_hash": "sha256:<hash of action parameters>",
  "decision": "approved",
  "modifications_hash": null,
  "nonce": "n_<uuid>",
  "request_id": "cr_<id>",
  "timestamp": "ISO-8601",
  "valid_until": "ISO-8601"
}
```

### 6.3 Verification

1. Reconstruct canonical payload from consent response
2. Compute SHA-256 hash
3. Verify Ed25519 signature against trusted public key
4. Verify nonce matches original request
5. Check expiration time

## 7. Audit Trail

### 7.1 Format

JSONL (one JSON object per line), stored at `~/.acp/audit.jsonl`.

### 7.2 Hash Chaining

Each event includes:
- `previous_event_hash`: SHA-256 hash of the previous event
- `event_hash`: SHA-256 hash of the current event (excluding this field)

Tampering with any event breaks the chain from that point forward.

### 7.3 Event Types

| Event | Description |
|---|---|
| `tool_call_intercepted` | Agent made a tool call |
| `policy_evaluated` | Policy engine made a decision |
| `consent_requested` | Human approval requested |
| `consent_approved` | Human approved |
| `consent_denied` | Human denied |
| `consent_expired` | Request timed out |
| `tool_call_forwarded` | Request sent to upstream MCP server |
| `tool_call_completed` | Upstream response received |
| `credential_injected` | Vault credential used (key name only) |

### 7.4 Event Schema

```json
{
  "type": "audit_event",
  "version": "0.2.0",
  "id": "ae_<unique>",
  "timestamp": "ISO-8601",
  "event_type": "string",
  "request_id": "cr_<id>",
  "agent": "string",
  "tool": "string",
  "category": "string",
  "risk_level": "string",
  "decision": "string",
  "response_time_ms": 0,
  "policy_rule": "string",
  "metadata": {},
  "previous_event_hash": "sha256:<hex> | null",
  "event_hash": "sha256:<hex>"
}
```

## 8. Configuration

### 8.1 Config File

Stored at `~/.acp/config.yml`:

```yaml
version: "1"
channel: telegram | prompt | webhook

telegram:
  bot_token: "encrypted:<...>"
  chat_id: "123456789"

webhook:
  url: "https://example.com/acp/callback"
  secret: "encrypted:<...>"

proxy:
  port: 8443
  upstream_servers:
    - name: "default"
      command: "npx @modelcontextprotocol/server-filesystem /tmp"
    - name: "github"
      url: "http://localhost:3001"

defaults:
  timeout_seconds: 120
  policy: "~/.acp/policy.yml"
```

## 9. Security Requirements

1. **Process isolation**: ACP proxy MUST run as a separate process from the agent
2. **Network enforcement**: Agent SHOULD be network-isolated (MUST warn if not)
3. **Credential separation**: Agent MUST NOT have access to vault contents
4. **Nonce binding**: Approvals MUST be nonce-bound (no replay)
5. **Time limits**: Approvals MUST be time-limited
6. **Append-only audit**: Audit trail MUST be append-only and hash-chained
7. **Out-of-band channel**: Approval channel MUST be unreachable by the agent
8. **Key isolation**: Agent MUST NOT have access to signing keys

## 10. Transport

### 10.1 Agent ↔ ACP Proxy

The ACP proxy accepts MCP connections via:
- **stdio**: ACP spawns the agent, piping stdin/stdout as MCP JSON-RPC
- **HTTP/SSE**: ACP listens on a local port, agent connects via HTTP

### 10.2 ACP Proxy ↔ Upstream MCP Servers

ACP connects to real MCP servers via:
- **stdio**: ACP spawns the MCP server process
- **HTTP/SSE**: ACP connects to a running MCP server URL

---

*For implementation details, see the [CLI source](cli/) and [architecture docs](docs/how-it-works.md).*
