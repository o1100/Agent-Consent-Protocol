# How ACP Works (`v0.3.0`)

ACP `v0.3.0` is VM-first for OpenClaw on Linux.

## Runtime Model

`acp start openclaw --openclaw-user=openclaw` starts three cooperating controls:

1. OpenClaw gateway process (runs as non-root `openclaw` user)
2. ACP HTTP consent proxy on `127.0.0.1:<port>`
3. nftables egress rules for the OpenClaw UID (fail-closed)

## Egress Enforcement Path

```text
OpenClaw process (uid=openclaw)
  -> outbound HTTP/HTTPS
  -> forced to ACP proxy via env + nftables egress constraints
  -> ACP policy decision (allow | ask | deny)
  -> Telegram/Webhook/Prompt consent (for ask)
  -> forward or block
```

Key property: OpenClaw cannot directly open arbitrary outbound TCP sessions once nftables rules are active.

## Consent Decision Flow

1. ACP builds an action record (`kind=http`, host, method, url)
2. Policy is evaluated top-to-bottom, first match wins
3. `allow`: request is forwarded
4. `deny`: request is rejected
5. `ask`: ACP sends approval request to the configured channel and waits for verdict
6. Result is appended to audit log (`audit.jsonl`)

Failures in consent path default to deny.

## Runtime Safeguards

- Startup lock prevents concurrent `acp start openclaw` supervisors for the same runtime user.
- Recent approved HTTP host decisions are cached briefly (host + `www.` twin) to reduce repeat prompts.

## Data and Config Locations

Default paths when running `--openclaw-user=openclaw`:

- ACP config: `/home/openclaw/.acp/config.yml`
- ACP policy: `/home/openclaw/.acp/policy.yml`
- ACP audit log: `/home/openclaw/.acp/audit.jsonl`
- OpenClaw config source: `/home/openclaw/.openclaw/openclaw.json`
- Workspace: `/home/openclaw/openclaw-workspace`

## Current Security Boundary

What is enforced now:

- OpenClaw runs non-root
- ACP binaries are typically root-owned (if installed globally with sudo)
- outbound network mediation is fail-closed while ACP is running

What is not fully hardened yet by default:

- ACP user-level config in `/home/openclaw/.acp` is writable by OpenClaw
- systemd hardening and root-owned config layout are operator responsibilities today

## Legacy Mode (`acp contain`)

Docker containment mode still exists for compatibility and non-OpenClaw use cases.

In `v0.3.0`, it is secondary to VM-first OpenClaw mode.
