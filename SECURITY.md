# Security Policy

## ⚠️ Project Status

ACP is an **experimental prototype** — an early research implementation of agent consent enforcement. It has not undergone formal security review and **should not be used to protect high-risk systems yet**.

We take security seriously and are working toward a hardened v1. If you find issues, we want to know.

## Supported Versions

Only the latest published version receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✅ Current |
| 0.2.x   | ❌         |

## Known Limitations

These are architectural gaps we're actively working on. They are **not bugs** — they are features that don't exist yet:

1. **Network isolation now available via `--contained`** — The `--contained` flag launches the agent inside a Docker container with `--internal` networking, providing full network isolation without requiring root. Without `--contained`, the agent can still make direct network requests bypassing ACP.

2. **MCP-only interception (without contained mode)** — In default mode, ACP only intercepts MCP tool calls. In contained mode (`--contained`), ACP also covers shell commands, HTTP requests, and Docker access via interceptors, since the agent runs inside an isolated Docker container with no outbound network access.

3. **Private key stored unencrypted** — The Ed25519 signing key at `~/.acp/keys/private.key` is stored as plaintext hex. An agent running as the same OS user could read it.

4. **No replay protection** — Consent proofs include a nonce but there is no server-side nonce store to prevent replay. A captured proof could theoretically be reused.

5. **Consent binds to tool name only** — The consent proof signs the arguments hash, but the human approval UI shows arguments at approval time. There's no enforcement that the arguments haven't changed between display and execution (they can't in the current flow, but the proof doesn't bind to a specific request ID the human saw).

6. **Same-user process model** — In default mode, the agent runs as the same OS user as ACP and could theoretically read ACP's config, keys, and vault. In contained mode (`--contained`), this is mitigated: the agent runs inside a Docker container where `~/.acp/` is not mounted, so the agent has no access to ACP's private key, config, or vault.

See [THREAT-MODEL.md](THREAT-MODEL.md) for the full analysis.

## Reporting a Vulnerability

**Email:** hello@agent2fa.dev

Please include:
- Description of the issue
- Steps to reproduce (if applicable)
- Impact assessment

We aim to acknowledge reports within 48 hours and provide a fix or mitigation within 7 days for confirmed issues.

**Please do not open public GitHub issues for security vulnerabilities.**

## Scope

The following are in scope for security reports:
- Bypasses of the consent gate (getting tool calls through without approval)
- Cryptographic issues in consent proofs or audit trail
- Credential vault encryption weaknesses
- Policy engine bypasses
- Anything that lets an agent act without human knowledge

The following are **out of scope** (known limitations listed above):
- Network isolation requiring root (documented)
- Non-MCP agent actions (documented)
- Same-user privilege escalation (documented)
