# Agent Consent Protocol (ACP) — Specification

**Version:** 0.1.0 (Draft)  
**Status:** Draft RFC  
**License:** Apache 2.0

## 1. Overview

The Agent Consent Protocol (ACP) is an open, framework-agnostic standard for obtaining human authorization before AI agents execute consequential actions. It provides:

1. **Mandatory consent gates** — Actions above a risk threshold require human approval
2. **Out-of-band delivery** — Approval requests travel through a channel the agent cannot access
3. **Cryptographic proofs** — Approvals are Ed25519-signed, nonce-bound, and time-limited
4. **Policy engine** — Declarative rules: auto-approve, always-ask, never-allow, and more
5. **Audit trail** — Hash-chained, append-only log of all consent events

## 2. Terminology

| Term | Definition |
|---|---|
| **Agent** | An AI system requesting to perform an action |
| **ACP Middleware** | Library that intercepts agent tool calls and enforces consent |
| **Consent Gateway** | Server that manages consent requests, policies, and routing |
| **Approval Channel** | Out-of-band channel to the human (Telegram, push, etc.) |
| **Approver** | Human who reviews and approves/denies requests |
| **Consent Proof** | Ed25519-signed attestation of a human's decision |

## 3. Consent Lifecycle

```
1. INTERCEPT  — Middleware intercepts a tool call
2. CLASSIFY   — Action classified by category and risk level
3. EVALUATE   — Policy engine determines if approval is needed
4. REQUEST    — Consent request sent to Gateway
5. DELIVER    — Gateway delivers to human via approval channel
6. DECIDE     — Human approves/denies/modifies
7. SIGN       — Approval is cryptographically signed
8. VERIFY     — Middleware verifies signature, nonce, and time bounds
9. EXECUTE    — If valid, the tool call proceeds
10. LOG       — Everything recorded in audit trail
```

## 4. Action Taxonomy

### Categories
`communication` | `financial` | `data` | `system` | `public` | `identity` | `physical`

### Risk Levels
`low` | `medium` | `high` | `critical`

## 5. Message Types

### 5.1 Consent Request

```json
{
  "type": "consent_request",
  "version": "0.1.0",
  "id": "cr_<unique_id>",
  "timestamp": "ISO-8601",
  "expires_at": "ISO-8601",
  "agent": { "id": "string", "name": "string?" },
  "action": {
    "tool": "string",
    "category": "ActionCategory",
    "risk_level": "RiskLevel",
    "parameters": {},
    "description": "string"
  },
  "context": { "conversation_summary": "string?" },
  "nonce": "n_<uuid>",
  "callback_url": "string?"
}
```

### 5.2 Consent Response

```json
{
  "type": "consent_response",
  "version": "0.1.0",
  "request_id": "cr_<id>",
  "timestamp": "ISO-8601",
  "decision": "approved | denied | approved_with_modifications | escalated | deferred",
  "approver": { "id": "string", "channel": "string" },
  "modifications": {} | null,
  "conditions": { "valid_until": "ISO-8601" },
  "reason": "string?",
  "nonce": "n_<uuid>",
  "proof": {
    "algorithm": "Ed25519",
    "public_key": "hex",
    "signature": "hex",
    "signed_payload_hash": "sha256:<hex>"
  }
}
```

## 6. Cryptographic Proofs

### Signing Payload

The signed payload is a canonical JSON object:

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

Keys are sorted alphabetically. The payload is serialized with no whitespace, then signed with Ed25519.

### Verification Steps

1. Check public key is in the trusted set
2. Reconstruct the canonical payload
3. Verify SHA-256 hash matches
4. Verify Ed25519 signature
5. Check nonce matches original request
6. Check expiration

## 7. Policy Engine

### Decision Types

| Decision | Behavior |
|---|---|
| `auto_approve` | Execute immediately |
| `ask_once_per_session` | Ask first time, remember |
| `always_ask` | Ask every time |
| `never_allow` | Block immediately |

### Rule Evaluation

Rules are evaluated in priority order (highest first). First match wins.

## 8. Audit Trail

- **Format**: JSONL (one JSON object per line)
- **Integrity**: SHA-256 hash chaining (each event includes previous event's hash)
- **Events**: consent_requested, consent_approved, consent_denied, consent_expired, action_executed, policy_auto_approved, policy_auto_denied

## 9. REST API

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/consent/request` | Create consent request |
| GET | `/api/v1/consent/:id` | Check status |
| POST | `/api/v1/consent/:id/respond` | Submit human response |
| GET | `/api/v1/consent/:id/proof` | Get signed proof |
| GET | `/api/v1/audit` | Query audit trail |
| GET | `/api/v1/audit/verify` | Verify hash chain |
| GET | `/api/v1/policies` | Get current policy |
| PUT | `/api/v1/policies` | Update policy |

## 10. Security Requirements

1. Gateway MUST run in a separate process from the agent
2. Agent MUST NOT have access to signing keys
3. Approvals MUST be nonce-bound (no replay)
4. Approvals MUST be time-limited
5. Audit trail MUST be append-only and hash-chained
6. Approval channel MUST be out-of-band from the agent

---

For the complete specification with examples and schemas, see the [full deep-dive document](./research/agent-2fa-deep-dive.md).
