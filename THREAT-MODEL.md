# Threat Model

## What ACP Protects Against

| Threat | Protection | Status |
|--------|-----------|--------|
| Agent making MCP tool calls without human knowledge | Consent gate intercepts all MCP calls, requires approval | ✅ Working |
| Agent accessing credentials directly | Vault encrypts secrets (AES-256-GCM), injects only after approval | ✅ Working |
| Tampered audit trail | Hash-chained JSONL, each entry references previous hash | ✅ Working |
| Forged consent proofs | Ed25519 signed proofs with canonical JSON | ✅ Working |
| Unauthorized tool categories | YAML policy engine with allow/ask/deny rules | ✅ Working |
| Accidental dangerous actions | Human-in-the-loop via Telegram/terminal before execution | ✅ Working |

## What ACP Does NOT Protect Against (Yet)

| Threat | Why | Planned Fix |
|--------|-----|-------------|
| Agent making direct HTTP/network calls | ACP only proxies MCP — non-MCP traffic isn't intercepted | Network namespace isolation (requires root/Docker) |
| Agent reading ACP's private key | Same OS user, plaintext key file | Encrypt key at rest, sandboxed user |
| Agent reading ACP's config/vault | Same OS user, file permissions | Container isolation, separate user |
| Replayed consent proofs | No server-side nonce store | Nonce persistence + expiry |
| Agent using shell to bypass everything | `exec()` / `child_process` outside MCP | Network isolation + seccomp profiles |
| Compromised host OS | ACP runs in userspace, not a hypervisor | Out of scope (use VMs/containers) |

## Assumptions

ACP's security model assumes:

1. **The human approver is trusted** — ACP ensures humans decide, not that humans decide correctly.

2. **The approval channel is secure** — Telegram bot API uses HTTPS. Terminal mode assumes local access is trusted.

3. **The MCP protocol is the agent's interface** — If agents use MCP for tool calls, ACP can intercept them. If they bypass MCP, ACP cannot help without network isolation.

4. **Root/container access for full isolation** — The `--network-isolation` flag requires either root (for cgroups/iptables) or Docker. Without it, ACP operates in proxy-only mode where enforcement depends on the agent actually using the MCP proxy.

## Attacker Models

### Malicious Agent (Primary Threat)
An AI agent that actively tries to bypass consent to perform unauthorized actions.

- **With network isolation (root/Docker):** Agent is confined to the ACP proxy. Cannot make direct network calls. MCP calls require consent. ✅ Protected.
- **Without network isolation:** Agent can make direct HTTP requests, read files, spawn processes. ACP only catches MCP calls routed through its proxy. ⚠️ Partial protection.

### Prompt Injection
An external input tricks the agent into performing unintended actions.

- ACP catches this at the tool call level — even if the agent is tricked, the human sees the actual action before it executes. ✅ Protected (for MCP calls).

### Local Attacker (Same Machine)
A user or process on the same machine targets ACP itself.

- Private keys and config are readable by the same OS user. ⚠️ Not protected without container isolation.

### Network Attacker
An attacker intercepting traffic between ACP and MCP servers or Telegram.

- Telegram uses HTTPS. Local MCP uses stdio/localhost. ✅ Reasonable protection for typical deployments.

## Current Maturity

ACP is at the **"concept + CLI"** stage of the security protocol lifecycle:

```
[You are here]
     ↓
concept + CLI  →  working demo  →  formal threat model  →  hardened v1
                       ↑
                  (almost here)
```

The cryptographic primitives (Ed25519, AES-256-GCM, SHA-256, hash chains) are sound and use Node.js built-in crypto. The gaps are in the enforcement boundaries, not the crypto.
