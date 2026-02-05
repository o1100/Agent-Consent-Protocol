# Agent Consent Protocol — Security Audit & Project Review

**Date**: 2026-02-05
**Version Audited**: v0.3.0 (Docker containment refactor)
**Commit**: 586a6e4
**Auditor**: Claude (Opus 4.5) — Deep code review
**Scope**: Full source code, architecture, policy engine, containment, cryptography, threat model

---

## Executive Summary

ACP ("2FA for AI Agents") is a well-conceived project solving a real and increasingly urgent problem: how to give humans meaningful control over autonomous AI agent actions. The Docker-based containment approach in v0.3.0 is a significant architectural improvement over the earlier proxy-only model, providing genuine kernel-level enforcement on Linux.

The idea is strong. The implementation is clean and thoughtful for a prototype. There are several concrete security issues and design gaps that need attention before this could be considered production-grade.

---

## Ratings

| Criteria | Score | Notes |
|----------|-------|-------|
| **Idea / Vision** | 9/10 | Solves a real, timely problem. "2FA for AI Agents" is a compelling framing. Framework-agnostic approach via containers is the right call. |
| **Architecture** | 8/10 | Two-layer defense-in-depth (shell wrappers + HTTP proxy) is well-designed. Clean separation of concerns. Docker containment is the correct enforcement boundary. |
| **Code Quality** | 8/10 | Clean TypeScript, minimal dependencies, well-structured modules. Good use of interfaces. No dead code or unnecessary complexity. |
| **Security (Linux)** | 7/10 | Kernel-enforced network isolation (`--internal`), read-only FS, all caps dropped, no-new-privileges. Solid for the threat model. Specific issues detailed below. |
| **Security (macOS/Windows)** | 4/10 | Proxy-enforced only. Agent can bypass via direct TCP to raw IPs. Documented but still a significant gap for half the user base. |
| **Policy Engine** | 7/10 | Clean first-match-wins evaluation. Glob matching works. Some edge cases in pattern matching and rule ordering that could surprise users (see findings). |
| **Test Coverage** | 7/10 | 47 tests covering core logic. Missing: integration tests, CONNECT tunneling tests, actual wrapper execution, error recovery paths. |
| **Documentation** | 9/10 | Excellent README, threat model, spec, security policy. Honest about limitations. Better docs than most production projects. |
| **Dependency Risk** | 9/10 | Only 2 production deps (commander, yaml). Minimal supply chain attack surface. All network/crypto uses Node.js built-ins. |
| **Production Readiness** | 4/10 | Experimental prototype as stated. Key gaps in auth, token management, audit integrity, and cross-platform isolation prevent production use. |
| **Overall** | **7/10** | A strong prototype with sound architecture. Needs hardening in specific areas before production deployment. |

---

## The Idea: Feedback & Opinions

### What's Good

1. **The problem is real and growing.** AI agents are shipping in production (Claude Code, Devin, Cursor, OpenHands, etc.) and all of them can execute arbitrary shell commands and HTTP requests. The industry needs a universal consent layer.

2. **Framework-agnostic via containers is the right approach.** Rather than building plugins for each framework (LangChain, CrewAI, AutoGen), ACP wraps *any* agent in a Docker container. This is a fundamentally better architecture than framework-level hooks.

3. **Two-layer interception is clever.** Layer 1 (shell wrappers) gives semantic context ("the agent wants to run `git push`"), while Layer 2 (HTTP proxy) is the catch-all for anything that bypasses wrappers. This is genuine defense-in-depth.

4. **The Telegram channel is a killer feature.** Getting a push notification on your phone with "Agent wants to run `rm -rf ./data/`" and tapping Approve/Deny is exactly the right UX for this problem. This is genuinely "2FA for AI agents."

5. **Honest documentation.** The THREAT-MODEL.md and SECURITY.md openly state what ACP does and doesn't protect against. This is rare and commendable.

### What Concerns Me

1. **The gap between the spec and implementation is large.** The SPEC.md describes Ed25519 consent proofs, hash-chained audit logs, an encrypted credential vault, nonce-bound approvals, and rate limiting. The actual v0.3.0 Docker-contained implementation has none of these — it uses simple approval tokens, plain JSONL logging, and no cryptographic proofs. This creates a misleading impression of the security guarantees.

2. **The approval token system is too coarse.** When Layer 1 approves a command, a 60-second token is created that auto-approves *any* Layer 2 traffic. This means approving `git push` also silently approves any HTTP request the agent makes in the next 60 seconds. This is a design flaw, not just a missing feature.

3. **macOS/Windows gap undermines the value proposition.** Most developers use macOS. If ACP can't enforce isolation on macOS, and the docs say "proxy-enforced (weaker)," the practical security guarantee for the majority of users is significantly reduced.

4. **No authentication on the consent server.** The consent server on :8443 accepts POST /consent from anyone on the network. There's no authentication, no HMAC, no shared secret. In the contained Docker model this is partially mitigated by network isolation, but it's still a missing security layer.

5. **The "cooperative agent" assumption is too generous.** The README positions this as security for AI agents, but the actual enforcement only works against agents that don't try to bypass it (on macOS/Windows) or that don't exploit the 60-second approval token window. A more honest framing would be "guardrails for well-behaved agents" rather than "security enforcement."

---

## Security Findings

### CRITICAL

#### C1: Approval Token Grants Blanket Network Access (consent-server.ts:30-37, http-proxy.ts:99-104)

When Layer 1 approves a shell command, a token is stored in the `approvalTokens` map. The HTTP proxy checks `hasValidApprovalToken()` which returns `true` if *any* valid token exists — it doesn't check what was approved. This means:

1. Agent requests approval for `git status` (benign)
2. Human approves
3. Within 60 seconds, agent makes HTTP request to `evil.com`
4. Proxy sees valid token, auto-approves without checking the gate

**Impact**: An agent can launder approvals. Get a benign command approved, then use the token window to make unauthorized network requests.

**Recommendation**: Tokens should be scoped to specific actions or at minimum consumed (single-use) after first proxy check.

#### C2: No Authentication on Consent Server (consent-server.ts:65-74)

The consent server listens on `0.0.0.0:8443` with no authentication. Any process that can reach the server can submit consent requests with arbitrary command names/args. In the Docker model, the container is isolated, but:

- On Linux, the server is reachable from the `acp-jail` network (any container on it)
- The server binds to `0.0.0.0`, making it reachable from *all* network interfaces on the host

**Impact**: Other processes on the host, or other containers on the same Docker network, could submit fake consent requests or probe the server.

**Recommendation**: Bind to the gateway IP only (not 0.0.0.0), or add a shared secret/HMAC that the wrappers include in requests.

#### C3: Shell Command Injection in Wrapper Generation (shell-wrappers.ts:159)

```typescript
const allPaths = execSync(`which -a ${cmd} 2>/dev/null || true`, { encoding: 'utf-8' })
```

The `cmd` variable comes from the policy's `wrap` list (YAML). If a policy file contains a malicious command name like `; rm -rf /`, it gets interpolated directly into a shell command via `execSync`. While policy files are typically authored by the user, this is still a command injection vector if policies are sourced from untrusted locations (e.g., a shared repo).

**Impact**: Arbitrary command execution on the host during wrapper generation (before Docker containment starts).

**Recommendation**: Validate command names against a strict allowlist pattern (alphanumeric + hyphens only), or use `execFileSync` with array arguments.

### HIGH

#### H1: Unbounded Request Body Parsing (consent-server.ts:107-109)

```typescript
let body = '';
for await (const chunk of req) {
  body += chunk;
}
```

The consent server reads the entire request body into memory with no size limit. An attacker (or misbehaving agent) can send a multi-gigabyte POST body and cause an out-of-memory crash, taking down the consent server and leaving the agent either blocked or (depending on fail mode) uncontrolled.

**Impact**: Denial of service against the consent enforcement layer.

**Recommendation**: Add a body size limit (e.g., 64KB) and abort the request if exceeded.

#### H2: Policy Rule Ordering Creates Silent Bypass (default.yml:57-76)

In the default policy, the `deny` rules for `rm -rf /*` are listed *after* the `ask` rule for `rm`:

```yaml
- match: { name: "rm" }
  action: ask                    # Line 69 — matches first!
- match: { name: "rm", args: "-rf /*" }
  action: deny                  # Line 74 — never reached
```

Since evaluation is first-match-wins, `rm -rf /*` hits the `ask` rule first. The human sees the request and can approve it — the `deny` rule is dead code.

**Impact**: The default policy's "never allow `rm -rf /`" guarantee is silently broken. The deny rule gives a false sense of security.

**Recommendation**: Reorder deny rules before ask rules, or document that deny rules must come first. Consider adding a policy validator that warns about shadowed rules.

#### H3: Glob Pattern Edge Cases in Host Matching (policy.ts:77-88)

The `globMatch` function converts `*.anthropic.com` to regex `^.*\.anthropic\.com$`. This means:

- `evil.anthropic.com` matches (correct)
- `evil-anthropic.com` does NOT match (correct, the dot is escaped)
- But `evilXanthropicYcom` does NOT match (correct)

However, the glob `*` matches any characters including dots, so `*.com` would match `anything.anything.com`. More critically, there's no anchoring on subdomain boundaries:

- Pattern `*.anthropic.com` matches `x.anthropic.com` but also `x.y.z.anthropic.com`

This is probably acceptable but should be documented. The real issue is that `anthropic.com` (no subdomain) does NOT match `*.anthropic.com` — the `*` requires at least one character. This could cause unexpected denials for apex domains.

#### H4: No Input Validation on Action Fields (consent-server.ts:121-131)

The consent server checks that `parsed.name` exists but performs no validation on its content. The `name` and `args` fields are passed directly into the policy engine and audit log. There's no sanitization, length limiting, or type checking beyond the initial `name` existence check.

- `args` can be undefined, a string, or (if JSON parsing is loose) any type
- No maximum length on `name` or `args`
- Special characters are passed through to audit logs and Telegram messages

**Impact**: Potential log injection (malformed JSONL entries), Telegram markdown injection, or memory exhaustion via extremely long strings.

### MEDIUM

#### M1: Audit Log Has No Integrity Protection (audit.ts)

The current implementation is a simple `fs.appendFileSync` of JSON lines. There is no:

- Hash chaining (specified in SPEC.md but not implemented)
- Digital signatures
- File permissions enforcement
- Rotation or size limits

A compromised process with write access to `~/.acp/audit.jsonl` can silently modify, delete, or append fake entries.

**Impact**: Audit trail can be tampered with without detection. This undermines the accountability guarantees.

#### M2: Telegram Bot Token Stored in Plaintext (init.ts:67-70)

The Telegram bot token is stored unencrypted in `~/.acp/config.yml`. Anyone with read access to this file can:

- Impersonate the ACP bot
- Send fake approval requests
- Read all messages sent to the bot (including consent requests with command details)

**Impact**: Compromise of the approval channel. An attacker who reads the token can auto-approve requests.

#### M3: Approval Token Uses Weak Randomness for Security Context (consent-server.ts:138)

```typescript
const token = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
```

`Math.random()` is not cryptographically secure. Token format is predictable: timestamp (known) + 6 chars of weak random. In the current architecture tokens are only checked for existence (not matched), so this is lower severity, but if tokens are ever matched or transmitted, they'd be guessable.

**Recommendation**: Use `crypto.randomUUID()` or `crypto.randomBytes()`.

#### M4: CONNECT Tunnel Has No Timeout (http-proxy.ts:220-243)

Once an HTTPS CONNECT tunnel is established, the bidirectional pipe has no timeout or data transfer limits. A malicious agent could:

- Keep tunnels open indefinitely, exhausting file descriptors
- Transfer unlimited data through an approved tunnel
- Use a single approval to maintain a persistent connection

#### M5: No Rate Limiting on Consent Requests

An agent can flood the consent server with rapid requests. Each `ask` action triggers a Telegram message or terminal prompt. There's no rate limiting, deduplication, or queuing. An agent could:

- Spam the human's phone with hundreds of approval requests per second
- Cause approval fatigue, leading to rubber-stamping
- Overwhelm the Telegram API rate limits, causing legitimate requests to fail

#### M6: Wrapper Uses `$*` Instead of `"$@"` for Args (shell-wrappers.ts:186)

```bash
FULL_CMD="${cmd} $*"
```

`$*` concatenates all arguments into a single string (separated by the first character of IFS). This means the consent server sees `git commit -m hello world` instead of the actual argument boundaries. The human approving the action may not realize the command has different quoting than displayed.

The actual execution uses `exec "$REAL_CMD" "$@"` (correct), but the consent display uses the flattened `$*` form.

**Impact**: The human approves a slightly different representation than what actually executes. Arguments with spaces or special characters are misrepresented.

### LOW

#### L1: No Graceful Degradation When Layer 2 Fails (contain.ts:145-150)

If the HTTP proxy fails to start, the code prints a warning and continues:

```typescript
console.warn('  HTTP proxy failed: ...');
console.warn('  Continuing without Layer 2 interception.');
```

This means the entire network catch-all layer is silently disabled. The user may not notice the warning in the banner output.

#### L2: Docker Image Detection Is Fragile (docker.ts:146-149)

Image detection is based on the first word of the command: `python agent.py` → `python:3.12-slim`. But `./agent.py` or `/usr/bin/python3 agent.py` won't match, falling back to `ubuntu:24.04` which may not have the required runtime.

#### L3: Cleanup Race Condition (contain.ts:197-202)

The agent exit handler calls `cleanupAll()` and then `process.exit()`. The signal handlers also call `cleanupAll()`. If a signal arrives while the exit handler is running, cleanup runs twice. The `docker kill` in cleanup is best-effort, but the wrapper directory could be deleted while still in use.

#### L4: The TerminalChannel Doesn't Enforce Timeout (contain.ts:260)

The `_timeoutMs` parameter is accepted but never used. A terminal prompt will block forever waiting for input, even if the policy specifies a timeout. The `ask` result with no timeout means the agent hangs indefinitely if the human walks away.

---

## Architecture Feedback

### What Works Well

1. **Module boundaries are clean.** Types, policy, gate, channel, and audit are properly separated. The consent server and HTTP proxy are independent components that share the gate. This makes the system testable and extensible.

2. **The gate abstraction is elegant.** `(action: Action) => Promise<Verdict>` is a simple, composable interface. Everything flows through it — shell wrappers, HTTP proxy, and future interception layers all use the same gate.

3. **Fail-closed is the right default.** Shell wrappers exit 126 (deny) if the consent server is unreachable. This is the correct security posture.

4. **Minimal dependencies.** Using only `commander` and `yaml` as production dependencies is excellent. It means the entire security-critical path (HTTP server, proxy, crypto, audit) uses Node.js built-ins with no third-party code in the hot path.

### What Could Be Better

1. **The spec and implementation should converge.** Having a spec that describes Ed25519 proofs and hash-chained audit logs, while the implementation uses simple tokens and append-only files, creates confusion about what security guarantees actually hold. Either implement the spec or update the spec to match reality.

2. **Token scoping is the single most important fix.** The blanket approval token (C1 above) is the biggest architectural issue. The fix is straightforward: tokens should encode what was approved (command + args hash, or action type) and the proxy should validate the scope.

3. **Consider a policy linter/validator.** The rule-ordering issue (H2) is a usability trap. A `acp policy check` command that detects shadowed rules, unreachable deny rules, and common misconfigurations would prevent real-world policy errors.

4. **The macOS story needs a concrete plan.** Most developers use macOS. The current "bridge + proxy env vars" approach provides minimal security. Options to explore: Docker Desktop's new VM-based isolation, using `pfctl` firewall rules, or clearly documenting that macOS use is development-only and not security-enforced.

---

## Missing Features (Ranked by Impact)

| Priority | Feature | Why |
|----------|---------|-----|
| **P0** | Scoped approval tokens | Prevents approval laundering (C1) |
| **P0** | Request body size limits | Prevents DoS on consent server (H1) |
| **P0** | Fix default policy rule ordering | Deny rules must precede ask rules (H2) |
| **P1** | Consent server authentication | Prevent unauthorized consent submissions (C2) |
| **P1** | Input sanitization on action fields | Prevent injection attacks (H4) |
| **P1** | Consent request rate limiting | Prevent approval fatigue attacks (M5) |
| **P1** | Audit log integrity (hash chaining) | Match the spec's tamper-evident guarantee (M1) |
| **P2** | CONNECT tunnel timeouts | Prevent resource exhaustion (M4) |
| **P2** | Telegram token encryption | Protect approval channel credentials (M2) |
| **P2** | Cryptographic approval tokens | Replace Math.random() with crypto.randomBytes() (M3) |
| **P2** | Policy validator/linter | Catch shadowed rules and misconfigurations |
| **P3** | TerminalChannel timeout enforcement | Honor the timeout parameter (L4) |
| **P3** | Graceful Layer 2 failure handling | Make it obvious when proxy is down (L1) |
| **P3** | Improved image detection | Handle absolute paths and shebangs (L2) |

---

## Comparison to Alternatives

| Feature | ACP v0.3 | LangGraph HIL | CrewAI HIL | Docker --read-only |
|---------|----------|---------------|------------|-------------------|
| Framework-agnostic | Yes | No (LangGraph only) | No (CrewAI only) | Yes |
| Shell command interception | Yes (Layer 1) | No | No | No |
| HTTP interception | Yes (Layer 2) | No | No | No |
| Network isolation | Yes (Docker internal) | No | No | No |
| Push notifications | Yes (Telegram) | No | No | No |
| Policy engine | Yes (YAML rules) | Code-level | Code-level | No |
| Audit trail | Yes (JSONL) | Framework logs | Framework logs | No |
| Overhead | Container startup | In-process | In-process | Container startup |
| Bypass resistance (Linux) | High | Low | Low | Medium |

ACP fills a genuine gap. No other tool provides framework-agnostic, container-enforced consent with push notifications. The closest comparison is running agents in Docker with `--read-only` and `--cap-drop=ALL`, but that provides no consent mechanism — just blanket restriction.

---

## Conclusion

**The idea is excellent (9/10).** This is a genuinely needed tool, well-positioned in the market, with a sound architectural foundation.

**The implementation is solid for a prototype (7/10).** The code is clean, well-structured, and demonstrates good engineering judgment. The two-layer interception model, Docker containment, and Telegram integration are all well-executed.

**The security needs work before production (5/10 for production readiness).** The blanket approval token, unauthenticated consent server, default policy rule ordering bug, and spec/implementation divergence are concrete issues that need fixing. None are architectural dead-ends — they're all fixable within the current design.

**Recommendation**: Fix P0 issues (token scoping, body size limits, policy ordering), then pursue a formal security audit before any production deployment. The project is heading in the right direction.

---

*This audit was performed through static code analysis. No dynamic testing, fuzzing, or penetration testing was conducted.*
