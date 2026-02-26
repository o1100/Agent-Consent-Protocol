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

Key property: The openclaw UID cannot directly open arbitrary outbound TCP sessions once nftables rules are active.

**Important caveat:** This only covers network connections originating from the local machine. OpenClaw's built-in tools (`web_search`, `web_fetch`) execute server-side on OpenClaw's infrastructure — the local process sends an API call to OpenClaw's backend, and the backend performs the actual web request. ACP sees the API connection but has no visibility into what the agent does through its own tool channel. See [Known Gaps](#known-gaps) below.

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

## Known Gaps

### Agent-native tools bypass ACP

OpenClaw has built-in tools (`web_search`, `web_fetch`) that access the internet through OpenClaw's own API backend, not through local outbound connections. The enforcement chain looks like this:

```text
OpenClaw process (local, uid=openclaw)
  → API call to OpenClaw backend (via ACP proxy — allowed)
    → OpenClaw backend (server-side, invisible to ACP)
      → web_search("anything") → internet
      → web_fetch("anything") → internet
```

ACP gates the network pipe but cannot see or control what the agent does through its own API channel. This means OpenClaw can search the web and fetch URLs without triggering a consent request.

This is a fundamental limitation of network-layer enforcement for agents with server-side tool execution. Closing this gap would require OpenClaw to support proxy-aware or hook-based tool routing.

## Current Security Boundary

What is enforced now:

- OpenClaw runs non-root
- ACP binaries are typically root-owned (if installed globally with sudo)
- outbound network mediation is fail-closed while ACP is running
- shell commands (`curl`, `wget`, etc.) are intercepted by ACP

What is **not** covered:

- Agent-native tools (`web_search`, `web_fetch`) that execute server-side (see above)
- ACP user-level config in `/home/openclaw/.acp` is writable by OpenClaw
- systemd hardening and root-owned config layout are operator responsibilities today

## Legacy Mode (`acp contain`)

Docker containment mode still exists for compatibility and non-OpenClaw use cases.

In `v0.3.0`, it is secondary to VM-first OpenClaw mode.
