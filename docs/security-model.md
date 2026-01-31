# ACP Security Model

## Threat Model

ACP is designed to protect against the following threats:

| Threat | Description | Mitigation |
|---|---|---|
| **Prompt Injection** | Attacker injects instructions to trigger unauthorized actions | ACP gates the action regardless of *why* the agent wants to do it |
| **Tool Misuse** | Agent halluccinates or misinterprets instructions | Human reviews actual parameters before execution |
| **Consent Forgery** | Agent or attacker forges an approval | Ed25519 signatures — agent doesn't have signing keys |
| **Consent Replay** | Previous approval reused for different action | Nonce-based — each approval bound to specific request |
| **In-band Manipulation** | Agent intercepts the approval channel | Out-of-band requirement — separate process + channel |
| **Parameter Manipulation** | Parameters change between approval and execution | Approval binds to parameter hash |
| **Approval Fatigue** | Human auto-approves due to too many requests | Smart policies reduce noise |
| **Time-of-Check/Time-of-Use** | Parameters modified after approval | Hash binding + expiration |
| **Compromised Gateway** | Attacker takes over the gateway | Gateway only holds signing keys (not tool access) |
| **Channel Compromise** | Attacker takes over approval channel | Cryptographic proof is the primary security mechanism |

## Core Security Properties

### 1. Out-of-Band Approval

The defining security property. The approval channel is completely separate from the agent's runtime:
- **Separate process** — Gateway runs independently
- **Separate channel** — Human approves via Telegram/phone, not through the agent
- **Agent cannot observe** — The agent never sees approval channel traffic
- **Agent cannot forge** — The agent doesn't have signing keys

### 2. Cryptographic Binding

Every approval is cryptographically bound to:
- The specific request ID
- The exact action parameters (via hash)
- A unique nonce
- An expiration timestamp
- The approver's identity

This makes approvals **unforgeable**, **non-replayable**, and **tamper-evident**.

### 3. Nonce-Based Replay Prevention

Every consent request includes a unique cryptographic nonce. The approval signature covers this nonce. Reusing an old approval for a new request will fail nonce verification.

### 4. Hash-Chained Audit Trail

Every event is linked to the previous event's SHA-256 hash. Tampering with any event breaks the chain, making modifications detectable.

## Key Management

```
┌─────────────────────────────────┐
│         KEY HIERARCHY           │
│                                 │
│  Gateway Signing Key (Ed25519)  │
│  - Generated on first start    │
│  - Signs all consent proofs    │
│  - Private key stays in Gateway │
│  - Public key shared with SDKs │
│                                 │
│  Agent has: Public key only     │
│  Agent cannot: Sign proofs      │
│  Human has: Approval buttons    │
│  Human cannot: Sign directly    │
│     (Gateway signs on behalf)   │
└─────────────────────────────────┘
```

In the MVP, the Gateway holds the signing key and signs proofs on behalf of the human approver. In future versions, signing will move to the human's device (phone, hardware key) for true end-to-end security.

## What ACP Does NOT Protect Against

- **Physical access** to the Gateway server
- **Compromised human device** (if someone steals your phone)
- **Social engineering** of the approver (showing misleading context)
- **Denial of service** (flooding with consent requests)
- **Side-channel attacks** on the Gateway process

For these threats, standard security practices apply (encryption at rest, device authentication, rate limiting, monitoring).

## Recommendations

### Development
- Use `development.json` policy
- CLI adapter is fine
- No API key needed

### Production
- Use `default.json` or `strict.json` policy
- Enable API key authentication
- Run Gateway on a separate machine or container
- Use Telegram or push notifications (not CLI)
- Regular audit trail reviews
- Monitor for unusual patterns
