# Security Policy

## Project Status

ACP `v0.3.x` is an experimental Linux VM-first consent gate for OpenClaw.
It is functional, but it has **not** undergone a formal third-party security audit.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Current   |
| 0.2.x   | No        |

## Current Security Boundary (`v0.3.x`)

Primary deployment path:

```bash
sudo acp start openclaw --openclaw-user=openclaw
```

Enforced controls in this mode:

1. OpenClaw runs as a non-root Linux user.
2. ACP applies per-UID nftables egress rules (fail-closed).
3. Outbound HTTP/HTTPS is mediated through ACP policy + consent gate.
4. Decisions are written to append-only JSONL audit logs.

## Known Limitations

1. **Default user-owned config paths are tamperable by runtime user.**
   By default, ACP config/policy live under `/home/openclaw/.acp`.
   If OpenClaw user is compromised, policy/config can be modified.

2. **Approval channel trust and availability are external dependencies.**
   If Telegram/webhook paths are unavailable, `ask` flows can block or deny.

3. **OpenClaw dependency drift on first startup.**
   `acp start openclaw` installs `openclaw@latest` by default.
   Native dependency builds may require host toolchain (`build-essential`).

4. **Host compromise is out of scope.**
   If root or host OS is compromised, ACP guarantees do not hold.

5. **Legacy `acp contain` mode has different assumptions.**
   `acp contain` remains for compatibility and should not be treated as the
   primary `v0.3.x` production posture.

## Reporting a Vulnerability

**Email:** hello@agent2fa.dev

Include:
- issue description
- reproducible steps
- impact assessment

Please do not open public GitHub issues for security vulnerabilities.

## Scope

In scope:
- bypasses of consent gate in VM mode
- bypasses of nftables egress mediation
- policy evaluation and enforcement bypasses
- audit integrity gaps that hide actions

Out of scope (documented limitations):
- host/root compromise
- operator misconfiguration (for example leaving policy writable by runtime user)
- issues specific only to legacy `acp contain` mode when VM mode is not used
