# Threat Model (`v0.3.x`)

## What ACP Enforces

| Threat | Protection | Status |
|--------|-----------|--------|
| Direct outbound TCP from agent UID | nftables per-UID rules: only loopback proxy + DNS allowed, all else rejected | Working |
| Outbound HTTP/HTTPS without consent | ACP proxy evaluates policy per-request (`allow`/`ask`/`deny`) | Working |
| Silent outbound requests | `ask` decisions require explicit human approval via Telegram/webhook | Working |
| Duplicate ACP supervisors | PID-based startup lock per runtime user (`/tmp/acp-start-openclaw-<user>.pid`) | Working |
| No record of agent actions | Append-only JSONL audit log of every consent decision | Working |

## What ACP Does NOT Protect Against

| Threat | Why | Mitigation |
|--------|-----|------------|
| Agent-native tools (`web_search`, `web_fetch`) | Execute server-side on OpenClaw's infrastructure. ACP sees the API connection to OpenClaw's backend but cannot see or gate individual tool actions. The agent can search the web and fetch URLs without a consent request. | Requires the agent platform to support proxy-aware or hook-based tool routing. No mitigation available in ACP alone. |
| Runtime user modifying ACP config/policy | Default paths (`/home/openclaw/.acp/`) are owned by the agent's Linux user | Move config/policy/audit to root-owned paths (`/etc/acp`, `/var/lib/acp`, `/var/log/acp`) |
| HTTPS request body/content inspection | ACP uses CONNECT tunneling for HTTPS. It sees the destination host and port but not the request body or path. | ACP gates at host level only for HTTPS. Plain HTTP requests expose the full URL. |
| Consent channel compromise or outage | Telegram bot token and chat ID are external dependencies. If compromised, an attacker could approve requests. If unavailable, `ask` decisions block until timeout then deny. | Monitor channel availability. Rotate bot tokens. Use webhook with authentication for higher assurance. |
| Supply chain drift on first startup | `acp start openclaw` runs `npm install openclaw@latest` if the binary is missing | Pin versions or pre-install dependencies before enabling ACP |
| Host or root compromise | ACP relies on kernel nftables and root trust. If the host OS or root account is compromised, all guarantees are void. | Out of scope |
| Prompt injection leading to agent-native tool abuse | If an attacker injects a prompt that causes the agent to use `web_search`/`web_fetch`, those actions bypass ACP entirely (see above) | No mitigation available in ACP alone |
| Audit log tampering by runtime user | `audit.jsonl` lives under user-owned path by default. No hash chaining or signing. | Move audit log to root-owned path. No cryptographic integrity in v0.3.0. |

## Assumptions

1. Linux host with nftables userspace tool (`nft`) is available.
2. ACP is started with root/sudo privileges (`assertRoot()` enforced).
3. Agent runtime user is non-root (`UID >= 1` enforced in nftables rules).
4. Human approver and approval channel (Telegram/webhook) are trusted and available.
5. Operators take responsibility for hardening file ownership in production.

## Attacker Models

### Malicious Agent (Primary)

Goal: perform outbound actions without human consent.

Barriers:
- nftables blocks all outbound TCP from the agent UID except to ACP proxy on loopback
- ACP proxy evaluates every HTTP/HTTPS request against policy
- `ask` decisions require explicit human verdict via out-of-band channel

Gaps:
- Agent-native tools (`web_search`, `web_fetch`) execute server-side and bypass ACP entirely
- Agent can modify its own ACP policy/config if stored under its home directory
- Agent can read/tamper with audit log if stored under its home directory

### Prompt Injection

Goal: trick the agent into harmful outbound actions via injected instructions.

What ACP provides:
- Human sees the concrete network action (HTTP method + host) before approving, not just the agent's stated intent

Limitations:
- Human sees host-level information only for HTTPS (no path or body visibility)
- If the injected prompt causes the agent to use `web_search`/`web_fetch`, those bypass ACP
- ACP cannot distinguish legitimate agent actions from prompt-injection-induced actions

### Local Non-Root User (Agent UID)

Goal: interfere with ACP runtime or escape enforcement.

Barriers:
- nftables rules are installed by root and cannot be modified by the agent user
- ACP startup lock prevents the agent from running a second supervisor
- ACP binaries installed under root-owned paths are not writable

Gaps:
- Policy, config, and audit files under `/home/<user>/.acp/` are writable by the agent user
- Agent could disable proxy env vars in child processes (but nftables still blocks direct egress)

## What Is NOT in v0.3.0

The following were described in earlier spec drafts but are not implemented:

- Cryptographic proofs (Ed25519-signed approvals)
- Hash-chained audit trail
- Credential vault
- MCP protocol interception
- Cross-platform support (macOS, Windows)
- Rate limiting
- LD_PRELOAD socket interception
- Network namespace isolation

## Platform Scope

| | Linux VM (`acp start openclaw`) |
|---|---|
| Egress enforcement | nftables per-UID rules (kernel-level) |
| HTTP/HTTPS consent | ACP forward proxy on loopback |
| Consent channels | Telegram, webhook, terminal prompt |
| Audit | Append-only JSONL (no integrity chain) |
