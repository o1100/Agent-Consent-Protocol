# Security Audit Report — Agent Consent Protocol

**Date:** 2026-01-31
**Scope:** Full codebase review of `Agent-Consent-Protocol` v0.2.4
**Branch:** `claude/security-audit-UGiZO`
**Auditor:** Automated security review (Claude)

---

## Executive Summary

The Agent Consent Protocol (ACP) is a consent-enforced sandbox for AI agents that intercepts MCP tool calls and requires human approval before execution. The codebase is compact (~4,300 LOC TypeScript, 2 runtime dependencies) with solid cryptographic foundations. However, several issues were identified ranging from high-severity command injection risks to medium-severity consent ID predictability.

**Overall assessment:** The project has a good security architecture and minimal attack surface from its dependency choice. The critical issues below should be addressed before any production deployment.

| Severity | Count |
|----------|-------|
| HIGH     | 3     |
| MEDIUM   | 5     |
| LOW      | 3     |

---

## HIGH Severity Findings

### H-1: Shell Injection in Network Isolation (`network.ts`)

**File:** `cli/src/sandbox/network.ts:88-106`
**CWE:** CWE-78 (OS Command Injection)

All `execSync()` calls in the network isolation module use string interpolation without shell escaping:

```typescript
execSync(`mkdir -p ${cgroupPath}`);
execSync(`iptables -N ${chainName} 2>/dev/null || true`);
execSync(`iptables -A ${chainName} -o lo -p tcp --dport ${proxyPort} -j ACCEPT`);
execSync(`iptables -I OUTPUT 1 -m cgroup --path ${cgroupName} -j ${chainName}`);
```

While `cgroupName`, `chainName`, and `proxyPort` are currently derived from `process.pid` (an integer) and hardcoded prefixes, this pattern is fragile:

- **Current risk:** Low in isolation since `process.pid` is an integer. However, the teardown function `teardownLinuxCgroup` takes arbitrary string parameters from `JSON.parse(cleanupInfo)` at line 224, and if `cleanupInfo` were tampered with (e.g., via same-user filesystem access), it could inject commands.
- **Future risk:** Any refactor that introduces user-controlled values into these variables creates an immediate command injection vulnerability running **as root**.
- **Severity amplifier:** Network isolation requires root privileges, so any successful injection runs as root.

**Recommendation:** Use `execFileSync()` with argument arrays instead of `execSync()` with string interpolation. For example:
```typescript
execFileSync('mkdir', ['-p', cgroupPath]);
execFileSync('iptables', ['-N', chainName]);
```

---

### H-2: Predictable Consent Request IDs (`consent-gate.ts`)

**File:** `cli/src/proxy/consent-gate.ts:201`
**CWE:** CWE-330 (Use of Insufficiently Random Values)

Consent request IDs are generated using `Math.random()`:

```typescript
const consentId = `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
```

`Math.random()` is not cryptographically secure. Its output can be predicted if an attacker can observe a few values (V8's xorshift128+ PRNG state can be recovered from ~5 outputs).

The codebase already has a proper implementation at `cli/src/crypto/keys.ts:111-115`:

```typescript
export function generateRequestId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `cr_${ts}${rand}`;
}
```

This function uses `crypto.randomBytes()` but is **never called** — the consent gate uses the insecure inline version instead.

**Impact:** An attacker who can observe consent IDs (e.g., from audit logs or Telegram messages) could predict future IDs. Combined with the webhook channel (H-3), this could allow forging consent responses.

**Recommendation:** Replace the inline ID generation with the existing `generateRequestId()` function from `crypto/keys.ts`.

---

### H-3: Missing Webhook Response Authentication (`terminal.ts`)

**File:** `cli/src/channels/terminal.ts:274-288`
**CWE:** CWE-345 (Insufficient Verification of Data Authenticity)

The webhook channel sends the secret as a header on outgoing requests but does **not** verify the authenticity of the response:

```typescript
const response = await fetch(this.url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(this.secret ? { 'X-ACP-Secret': this.secret } : {}),
  },
  body: JSON.stringify({ type: 'consent_request', ...request }),
});

const result = await response.json() as { approved: boolean; reason?: string };
return result;  // No signature verification on response
```

**Impact:** A man-in-the-middle attacker or compromised network hop between ACP and the webhook endpoint could forge approval responses, auto-approving any tool call. This completely bypasses the consent mechanism for webhook users.

**Recommendation:**
1. Implement HMAC-SHA256 signature verification on webhook responses. The webhook server should sign its response body using the shared secret, and ACP should verify the signature before accepting the decision.
2. Consider adding a nonce/challenge to prevent replay attacks on webhook responses.

---

## MEDIUM Severity Findings

### M-1: Plaintext Private Key Storage

**File:** `cli/src/proxy/consent-gate.ts:97-101`, `cli/src/sandbox/credentials.ts:58-75`
**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)

The Ed25519 private key is stored as plaintext hex in `~/.acp/keys/private.key`. The same key is used for:
- Signing consent proofs
- Deriving the AES-256-GCM vault encryption key (via HKDF)

Since the agent process runs as the same OS user, it has filesystem access to read this key. A compromised agent could:
1. Read the private key
2. Forge consent proofs
3. Decrypt the credential vault

**Status:** Documented in `SECURITY.md` as a known limitation.

**Recommendation:** Encrypt the key at rest using OS keyring integration (e.g., `libsecret` on Linux, Keychain on macOS) or require a passphrase at startup.

---

### M-2: Wildcard CORS on Proxy Server (`mcp-proxy.ts`)

**File:** `cli/src/proxy/mcp-proxy.ts:90`
**CWE:** CWE-942 (Overly Permissive Cross-domain Whitelist)

```typescript
res.setHeader('Access-Control-Allow-Origin', '*');
```

The MCP proxy allows requests from any origin. While the server binds to `127.0.0.1` (line 137), this still allows any website loaded in a browser on the same machine to make requests to the proxy, potentially triggering tool calls through a confused-deputy attack.

**Mitigating factor:** The proxy binds to localhost only.

**Recommendation:** Restrict CORS to specific known origins or remove it entirely (MCP clients typically don't run in browsers). If browser-based MCP clients are a use case, document the security implications.

---

### M-3: Tool Arguments Logged in Audit Trail

**File:** `cli/src/proxy/mcp-proxy.ts:258-265`
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

Full tool arguments are logged in the audit trail:

```typescript
this.auditLogger.record({
  event_type: 'tool_call_intercepted',
  // ...
  metadata: { arguments: args },
});
```

And again after approval at line 327:

```typescript
metadata: { arguments: finalArgs },
```

`finalArgs` may contain injected vault secrets (post-credential injection). If audit logs are accessible to the agent or any other party, secrets are exposed.

**Recommendation:**
1. Log arguments **before** credential injection, not after.
2. Add a redaction pass that strips or masks values matching `$VAULT:*` patterns.
3. At minimum, ensure `tool_call_forwarded` at line 327 logs the pre-injection `args`, not `finalArgs`.

---

### M-4: No Replay Protection for Consent Proofs

**File:** `cli/src/proxy/consent-gate.ts:112-145`
**CWE:** CWE-294 (Authentication Bypass by Capture-replay)

Consent proofs include a nonce (line 121) but there is no server-side nonce store or expiry mechanism. A captured consent proof could theoretically be presented again for the same tool+arguments combination.

**Status:** Documented in `THREAT-MODEL.md`.

**Recommendation:** Implement a nonce cache with TTL. Reject any consent proof where the nonce has been seen before.

---

### M-5: Unbounded Request Body Size (`mcp-proxy.ts`)

**File:** `cli/src/proxy/mcp-proxy.ts:372-379`
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

The `readBody()` function reads the entire HTTP request body into memory without size limits:

```typescript
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
```

A malicious client could send an arbitrarily large request body, causing the proxy to run out of memory.

**Recommendation:** Add a maximum body size check (e.g., 1MB) and reject requests that exceed it.

---

## LOW Severity Findings

### L-1: ReDoS Risk in Policy Glob Matching (`engine.ts`)

**File:** `cli/src/policy/engine.ts:278-287`
**CWE:** CWE-1333 (Inefficient Regular Expression Complexity)

User-defined glob patterns from YAML policies are converted to regex:

```typescript
private globMatch(value: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(value);
}
```

Multiple `*` patterns (e.g., `*a*b*c*d*e*f*`) create a regex with nested `.*` quantifiers that can cause catastrophic backtracking. This is controllable via policy YAML files.

**Mitigating factor:** Policy files are controlled by the ACP operator, not the agent.

**Recommendation:** Use a purpose-built glob matching library or limit the number of wildcards per pattern.

---

### L-2: No HTTP-Level Rate Limiting on Proxy

**File:** `cli/src/proxy/mcp-proxy.ts`
**CWE:** CWE-770 (Allocation of Resources Without Limits)

The MCP proxy has tool-level rate limiting (in the policy engine) but no HTTP-level rate limiting. A compromised or misbehaving agent could flood the proxy with requests, degrading performance even if the tool calls are denied by policy.

**Recommendation:** Add connection-level rate limiting or request throttling.

---

### L-3: Fragile Command Parsing in Upstream Manager

**File:** `cli/src/proxy/upstream-manager.ts:79-81`
**CWE:** CWE-88 (Improper Neutralization of Argument Delimiters)

```typescript
const parts = this.command.split(/\s+/);
const cmd = parts[0];
const args = parts.slice(1);
```

The upstream command string is split on whitespace, which does not handle:
- Quoted arguments with spaces
- Escaped characters
- File paths with spaces

**Impact:** Commands with spaces in paths will fail silently, potentially leaving upstream servers disconnected and the user unaware.

**Recommendation:** Accept commands as arrays `[cmd, ...args]` in the configuration format, or use a proper shell-word splitting library.

---

## Positive Findings

The following security practices are well-implemented:

| Area | Assessment |
|------|-----------|
| **Dependency minimization** | Only 2 runtime dependencies (`commander`, `yaml`), drastically reducing supply chain risk |
| **Credential vault encryption** | AES-256-GCM with HKDF key derivation from Ed25519 key. Proper IV/salt handling |
| **Vault file permissions** | Written with mode `0o600` (owner read/write only) at `credentials.ts:178` |
| **Audit trail integrity** | SHA-256 hash-chained JSONL with chain verification function |
| **Environment sanitization** | Vault keys stripped from agent environment at `process.ts:84-87` |
| **Default-deny posture** | Policy engine defaults to `ask` if no rule matches in default policy |
| **Nonce in consent proofs** | Cryptographically secure nonce via `crypto.randomUUID()` at `keys.ts:105` |
| **Localhost binding** | Proxy binds to `127.0.0.1` only, not `0.0.0.0` at `mcp-proxy.ts:137` |
| **Graceful process cleanup** | SIGTERM with fallback to SIGKILL for upstream servers |
| **TypeScript strict mode** | Enabled in `tsconfig.json`, catching type errors at compile time |

---

## Threat Model Gaps

Beyond the specific findings above, the following architectural concerns are worth noting:

1. **Same-user isolation model:** The agent runs as the same OS user as ACP. Even with network isolation, the agent can read ACP's config directory (`~/.acp/`), including private keys and the vault. This is documented but represents a fundamental trust boundary issue.

2. **MCP-only interception:** ACP only intercepts MCP tool calls. An agent that makes direct HTTP requests, shell calls, or uses non-MCP channels bypasses ACP entirely. This is documented but worth re-emphasizing.

3. **Telegram channel security:** Telegram callback data (`acp_approve_{id}` / `acp_deny_{id}`) relies on the predictable consent ID (H-2). Anyone who can send callback queries to the bot with a guessed ID could approve/deny requests.

4. **No TLS on proxy:** The proxy uses plain HTTP on localhost. If network isolation is not active and the proxy port is reachable from other hosts (misconfiguration), traffic including credentials is in cleartext.

---

## Recommendations Summary (Priority Order)

| Priority | Finding | Action |
|----------|---------|--------|
| 1 | H-1 | Replace `execSync()` with `execFileSync()` using argument arrays in `network.ts` |
| 2 | H-2 | Use `generateRequestId()` from `crypto/keys.ts` instead of `Math.random()` in `consent-gate.ts` |
| 3 | H-3 | Implement HMAC-SHA256 verification on webhook responses |
| 4 | M-3 | Redact credentials from audit logs; log pre-injection args |
| 5 | M-5 | Add max body size limit to `readBody()` |
| 6 | M-2 | Restrict CORS or document the implications |
| 7 | M-1 | Encrypt private key at rest (OS keyring or passphrase) |
| 8 | M-4 | Implement nonce cache with TTL for replay protection |
| 9 | L-1 | Limit glob pattern complexity or use a dedicated library |
| 10 | L-2 | Add HTTP-level rate limiting |
| 11 | L-3 | Accept upstream commands as arrays |

---

*This audit covers the codebase as of commit `6d02f7b`. It is a point-in-time review and does not constitute a formal security certification.*
