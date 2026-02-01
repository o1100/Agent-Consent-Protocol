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
| Agent making direct HTTP/network calls | Docker `--internal` network blocks all outbound traffic (in contained mode) | ✅ Working (contained mode) |
| Agent reading ACP's private key | Private key is not mounted in the Docker container (in contained mode) | ✅ Working (contained mode) |
| Agent reading ACP's config/vault | `~/.acp/` is not mounted in the Docker container (in contained mode) | ✅ Working (contained mode) |
| Agent using shell to bypass everything | Docker network isolation prevents outbound access regardless of method (in contained mode) | ✅ Working (contained mode) |

## What ACP Does NOT Protect Against (Yet)

> **Note:** Threats marked "mitigated in contained mode" are resolved when running with `--contained`, which launches the agent inside a Docker container with `--internal` networking and no access to `~/.acp/`.

| Threat | Why | Status |
|--------|-----|--------|
| Agent making direct HTTP/network calls (default mode) | ACP only proxies MCP — non-MCP traffic isn't intercepted | ✅ Mitigated in contained mode |
| Agent reading ACP's private key (default mode) | Same OS user, plaintext key file | ✅ Mitigated in contained mode |
| Agent reading ACP's config/vault (default mode) | Same OS user, file permissions | ✅ Mitigated in contained mode |
| Replayed consent proofs | No server-side nonce store | Planned: Nonce persistence + expiry |
| Agent using shell to bypass everything (default mode) | `exec()` / `child_process` outside MCP | ✅ Mitigated in contained mode |
| Compromised host OS | ACP runs in userspace, not a hypervisor | Out of scope (use VMs/containers) |

## Assumptions

ACP's security model assumes:

1. **The human approver is trusted** — ACP ensures humans decide, not that humans decide correctly.

2. **The approval channel is secure** — Telegram bot API uses HTTPS. Terminal mode assumes local access is trusted.

3. **The MCP protocol is the agent's interface (default mode)** — If agents use MCP for tool calls, ACP can intercept them. If they bypass MCP, ACP cannot help without contained mode. In contained mode, Docker network isolation ensures the agent cannot reach the internet regardless of method.

4. **Docker for full isolation** — The `--contained` flag uses Docker with `--internal` networking to fully isolate the agent. Without it, ACP operates in proxy-only mode where enforcement depends on the agent actually using the MCP proxy.

## Attacker Models

### Malicious Agent (Primary Threat)
An AI agent that actively tries to bypass consent to perform unauthorized actions.

- **With contained mode (`--contained`):** Agent runs inside a Docker container with `--internal` networking. Cannot make direct network calls, cannot read ACP's keys or config (`~/.acp/` is not mounted). MCP calls require consent. ✅ Protected.
- **Without contained mode:** Agent can make direct HTTP requests, read files (including `~/.acp/`), spawn processes. ACP only catches MCP calls routed through its proxy. ⚠️ Partial protection.

### Prompt Injection
An external input tricks the agent into performing unintended actions.

- ACP catches this at the tool call level — even if the agent is tricked, the human sees the actual action before it executes. ✅ Protected (for MCP calls).

### Local Attacker (Same Machine)
A user or process on the same machine targets ACP itself.

- In default mode, private keys and config are readable by the same OS user. ⚠️ Not protected without contained mode.
- In contained mode, the agent has no access to `~/.acp/` (not mounted in the container). ✅ Protected.

### Network Attacker
An attacker intercepting traffic between ACP and MCP servers or Telegram.

- Telegram uses HTTPS. Local MCP uses stdio/localhost. ✅ Reasonable protection for typical deployments.

## Current Maturity

ACP is at the **"working demo"** stage of the security protocol lifecycle, with Docker containment providing real enforcement boundaries:

```
                  [You are here]
                       ↓
concept + CLI  →  working demo  →  formal threat model  →  hardened v1
```

The cryptographic primitives (Ed25519, AES-256-GCM, SHA-256, hash chains) are sound and use Node.js built-in crypto. With `--contained` mode, enforcement boundaries are now backed by Docker network isolation, addressing the major gaps in the default proxy-only mode.
