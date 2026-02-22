# Threat Model (`v0.3.x`)

## What ACP Protects Against

| Threat | Protection | Status |
|--------|-----------|--------|
| OpenClaw direct outbound TCP egress | nftables per-UID fail-closed rules | Working (Linux VM mode) |
| Unauthorized HTTP/HTTPS actions | ACP proxy + policy (`allow`/`ask`/`deny`) | Working |
| Silent high-risk requests | Human approval for `ask` decisions | Working |
| Duplicate ACP runtime supervisors causing ambiguous state | startup lock in `acp start openclaw` | Working |
| Loss of action visibility | append-only JSONL audit logging | Working |

## What ACP Does NOT Fully Protect Against (Yet)

| Threat | Why | Mitigation |
|--------|-----|------------|
| Runtime user tampering with policy/config defaults | default paths are under `/home/openclaw/.acp` | move config/policy to root-owned paths (`/etc/acp`) |
| Host/root compromise | ACP relies on host kernel and root trust | out of scope |
| Consent channel compromise/outage | external dependency (Telegram/webhook) | hardened channel operations + monitoring |
| Deterministic dependency supply at startup | `openclaw@latest` is installed on first run | pin versions + pre-bake artifacts in release flow |
| Legacy `acp contain` parity with VM mode guarantees | compatibility path has different boundary assumptions | prefer VM mode for production |

## Assumptions

1. Linux host with nftables is available.
2. ACP startup is executed with root/sudo privileges.
3. OpenClaw runtime user is non-root.
4. Human approver and approval channel are trusted.
5. Operators harden file ownership for policy/config in production.

## Attacker Models

### Malicious Agent (Primary)

Goal: perform outbound actions without consent.

Current barriers:
- direct outbound egress blocked by nftables policy
- HTTP/HTTPS flow mediated by ACP gate
- `ask` decisions require explicit human verdict

### Prompt Injection

Goal: trick agent into harmful external actions.

Current barrier:
- humans approve concrete outbound action context, not just agent intent text

### Local Non-Root User

Goal: interfere with ACP runtime behavior.

Current barriers:
- ACP is started as root and enforces kernel-level egress rules
- startup lock blocks duplicate runtime instances

Known caveat:
- if policy/config remains user-writable, local user compromise can weaken policy

## Platform Scope

| | Linux VM (`acp start openclaw`) |
|---|---|
| Egress mediation | kernel-enforced via nftables |
| Consent gate | ACP proxy + policy engine |
| Primary support status | supported |

## Maturity

```text
concept -> working prototype -> [v0.3.x] -> hardened ops defaults -> formal audit
```
