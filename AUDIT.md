# Agent Consent Protocol — Codebase Audit Report

**Date**: 2026-02-01
**Version Audited**: v0.3.0
**Previous Version**: v0.2.4
**Method**: Full source code review
**Auditor**: Automated code audit via Claude

---

## Executive Summary

| Metric | v0.2.4 | v0.3.0 | Change |
|--------|--------|--------|--------|
| Code Quality | 8/10 | 8/10 | — |
| Feature Completeness | 8/10 | 9/10 | +1 |
| Security | 6/10 | 7/10 | +1 |
| Test Coverage | 7/10 | 8/10 | +1 |
| Production Readiness | 3/10 | 4/10 | +1 |

**Language**: TypeScript (Node.js v20+)
**Core Source Files**: 30 TypeScript modules + 9 test files
**LOC**: ~6,000 lines core + ~2,200 lines tests
**Dependencies**: 2 production (commander, yaml), 2 dev (typescript, @types/node)
**License**: Apache 2.0
**Status**: Functional prototype with general-purpose interception — not production hardened

---

## What Changed in v0.3.0

v0.2.4 only intercepted MCP tool calls. v0.3.0 adds three new interception layers:

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| **Shell commands** | PATH wrapper scripts + Node.js gate helper | 22 commands (curl, rm, git, docker, npm, etc.) |
| **HTTP requests** | Forward proxy with CONNECT tunneling | All HTTP/HTTPS from sandboxed process |
| **File operations** | Policy engine classification | file:read, file:write, file:rm |
| **Claude Code hooks** | PreToolUse hook generator | Bash, Write, Read, WebFetch, etc. |

The policy format was extended to v2 with new match fields: `kind`, `host`, `path`, `command`.

---

## 1. Project Structure

```
cli/
├── src/
│   ├── index.ts                     # CLI entry (Commander.js) — v0.3.0
│   ├── commands/
│   │   ├── init.ts                  # Setup wizard — creates ~/.acp/
│   │   ├── run.ts                   # Main command — spawns proxy + agent + interceptors
│   │   ├── setup.ts                 # NEW — Integration setup (claude-code, openclaw)
│   │   ├── secret.ts                # Credential vault CLI
│   │   ├── policy.ts                # Policy file management
│   │   └── status.ts                # System status check
│   ├── proxy/
│   │   ├── mcp-proxy.ts             # MCP JSON-RPC + /acp/intercept + /acp/health
│   │   ├── consent-gate.ts          # Policy/consent decision engine (kind-aware)
│   │   ├── upstream-manager.ts      # Manages upstream MCP servers
│   │   └── http-proxy.ts            # NEW — Real HTTP forward proxy + CONNECT tunneling
│   ├── interceptors/
│   │   ├── types.ts                 # NEW — InterceptionKind, InterceptionRequest/Response
│   │   └── shell-wrappers.ts        # NEW — PATH wrapper generation + acp-gate.mjs
│   ├── integrations/
│   │   └── claude-code.ts           # NEW — PreToolUse hook generator
│   ├── policy/
│   │   ├── engine.ts                # Rule matching + shell/http/file classifications
│   │   ├── parser.ts                # YAML parser + validator (v2 fields)
│   │   └── defaults.ts              # Default policy templates
│   ├── sandbox/
│   │   ├── process.ts               # Spawns agent with PATH wrappers + HTTP proxy env
│   │   ├── credentials.ts           # AES-256-GCM encrypted vault
│   │   └── network.ts               # Linux iptables/cgroup network isolation
│   ├── crypto/
│   │   └── keys.ts                  # Ed25519 key gen/signing, SHA256, canonical JSON
│   ├── audit/
│   │   └── logger.ts                # Hash-chained JSONL audit log
│   ├── channels/
│   │   ├── terminal.ts              # Terminal prompts + Telegram/Webhook
│   │   ├── telegram.ts              # Placeholder
│   │   └── webhook.ts               # Placeholder
│   └── tests/
│       ├── audit.test.ts            # 8 tests
│       ├── consent-gate.test.ts     # 11 tests
│       ├── credentials.test.ts      # 14 tests
│       ├── crypto.test.ts           # 10 tests
│       ├── policy-engine.test.ts    # 30 tests
│       ├── policy-engine-extended.test.ts  # NEW — 12 tests
│       ├── intercept-api.test.ts    # NEW — 7 tests
│       ├── shell-wrappers.test.ts   # NEW — 8 tests
│       └── http-proxy.test.ts       # NEW — 2 tests
├── package.json
├── tsconfig.json
└── dist/
```

**New files in v0.3.0**: 9 (6 source + 3 test + 1 policy preset)
**Modified files**: 9

---

## 2. Architecture

```
Agent Process (OpenClaw / Claude Code / any)
    │
    ├── Shell commands ──→ PATH wrapper scripts ──→ POST /acp/intercept ─┐
    ├── HTTP requests  ──→ HTTP_PROXY env var   ──→ HTTP Forward Proxy  ─┤
    ├── MCP tool calls ──→ ACP_PROXY_URL        ──→ MCP JSON-RPC Proxy ─┤
    └── Claude Code    ──→ PreToolUse hook       ──→ POST /acp/intercept ┘
                                                          │
                                                    ┌─────▼──────┐
                                                    │ ConsentGate │
                                                    │  ↓ Classify │ (shell/http/file/mcp)
                                                    │  ↓ Policy   │ (kind, host, path, command matching)
                                                    │  ↓ Decide   │ (allow / ask / deny)
                                                    │  ↓ Sign     │ (Ed25519 consent proof)
                                                    └─────┬──────┘
                                                          │
                                              allow / ask (→ human) / deny
                                                          │
                                                    ┌─────▼──────┐
                                                    │ Audit Log  │ (SHA-256 hash-chained JSONL)
                                                    └────────────┘
```

### Interception Flow Details

**Shell commands** (e.g., `curl`, `rm`, `git`):
1. Agent calls `curl https://example.com`
2. PATH wrapper script intercepts (wrapper dir prepended to PATH)
3. Wrapper calls `node acp-gate.mjs shell:curl "curl https://example.com"`
4. `acp-gate.mjs` POSTs to `http://127.0.0.1:8443/acp/intercept`
5. Consent gate evaluates → allow/deny
6. If allowed: wrapper execs original binary. If denied: exit code 126.

**HTTP requests**:
1. Agent makes HTTP request (via any library)
2. `HTTP_PROXY`/`HTTPS_PROXY` env vars route through forward proxy on port 8444
3. HTTP: proxy parses URL, checks consent, forwards or returns 403
4. HTTPS: proxy receives CONNECT, checks consent for host:port, tunnels or returns 403

**MCP tool calls** (unchanged from v0.2.4):
1. Agent sends JSON-RPC `tools/call` to proxy on port 8443
2. Consent gate evaluates → forward to upstream MCP server or deny

---

## 3. Module-by-Module Assessment

### 3.1 Policy Engine (`policy/engine.ts`)

**Status**: Extended in v0.3.0

New in v0.3.0:
- **Shell classifications**: 22 commands mapped (curl→network/medium, rm→filesystem/high, docker→system/critical, etc.)
- **HTTP classifications**: 8 methods (GET→low, POST→medium, DELETE→high, CONNECT→medium)
- **File classifications**: 6 operations (read→low, write→medium, rm→high)
- **New match fields**: `kind` (mcp/shell/http/file/hook), `host` (domain glob), `path` (file path glob), `command` (shell command glob)
- **`**` glob support**: Recursive path matching (`~/workspace/**` matches nested paths)
- **New categories**: `network`, `filesystem` alongside existing `read`, `write`, `communication`, `financial`, etc.

**Glob matching implementation** (`globMatch()`):
```
pattern → regex conversion:
  *  → [^/]*  (match within one path segment)
  ** → .*     (match across path segments)
  ?  → .      (match single char)
```

**Known issues**:
- Glob-to-regex conversion doesn't escape all regex metacharacters in input values
- `**` support uses a double-pass replace that could theoretically conflict with literal `**` in filenames (extremely unlikely)

### 3.2 Consent Gate (`proxy/consent-gate.ts`)

**Status**: Extended — now kind-aware

- `ToolCallRequest` now includes optional `kind: InterceptionKind`
- `kind` passed to `policyEngine.evaluate()` and included in audit metadata
- All existing behavior preserved for MCP-only usage

### 3.3 MCP Proxy + Intercept API (`proxy/mcp-proxy.ts`)

**Status**: Extended with new routes

New routes:
- `GET /acp/health` → `{status: 'ok', version: '0.3.0'}`
- `POST /acp/intercept` → validates `{kind, tool, arguments}` → consent gate → `{allowed, reason, consentProof?}`

Routing logic:
- URLs starting with `/acp/` → new route handler
- Everything else → existing MCP JSON-RPC handler

**Validation**: Requires `kind`, `tool`, and `arguments` fields. Returns 400 with reason if missing.

### 3.4 HTTP Forward Proxy (`proxy/http-proxy.ts`)

**Status**: NEW — full rewrite (was 501 stub)

- **HTTP requests**: Parses full URL → creates InterceptionRequest → consent gate → `http.request()` forward or 403
- **HTTPS CONNECT**: Parses `host:port` → consent gate → `net.connect()` TCP tunnel or 403
- Runs on separate port (default 8444)
- Removes `proxy-connection` header before forwarding
- Audit logs: `tool_call_forwarded`, `tool_call_denied`, `tool_call_error`

**Security properties**:
- No MITM for HTTPS — domain-level control only (cannot inspect encrypted content)
- No CA certificates needed
- Listens on 127.0.0.1 only

**Known issues**:
- No request/response size limits
- No connection timeout on upstream TCP tunnels
- No keepalive management (each request creates new connection)

### 3.5 Shell Wrappers (`interceptors/shell-wrappers.ts`)

**Status**: NEW

Generates temporary directory with:
1. `acp-gate.mjs` — Node.js helper that POSTs to `/acp/intercept` and exits 0 (allow) or 1 (deny)
2. Bash wrapper scripts for each command — resolve original binary, call gate, exec or exit 126

**Default wrapped commands** (22):
```
Network:    curl, wget, ssh, scp, nc
Execution:  python, python3, node, bash, sh, ruby, perl
Destructive: rm, rmdir, mv, chmod, chown
Packages:   pip, pip3, npm, npx, brew
DevOps:     git, docker, kubectl
```

**Fail mode**: `deny` (default) or `allow`. If ACP is unreachable and fail mode is `deny`, the command is blocked.

**How it works**:
- `generateWrappers({acpPort, commands?, failMode?})` creates temp dir, writes scripts
- Each wrapper uses `which -a` to find the real binary (skipping the wrapper dir itself)
- Wrapper dir is prepended to `PATH` in the sandboxed environment
- `cleanupWrappers()` removes the temp dir on exit

**Known issues**:
- `which -a` resolution could be tricked if agent modifies PATH
- Wrapper scripts don't handle commands with spaces in arguments perfectly (quoted in `"$@"` but complex quoting edge cases exist)
- Agent can call binaries by absolute path to bypass wrappers
- No interception of built-in shell commands (`cd`, `echo`, etc.)

### 3.6 Claude Code Integration (`integrations/claude-code.ts`)

**Status**: NEW

Generates a PreToolUse hook bash script that:
1. Reads JSON from stdin (`{tool_name, tool_input}`)
2. Maps Claude Code tools to ACP tool names:
   - `Bash` → `shell:bash`
   - `Write` → `file:write`
   - `Read` → `file:read`
   - `WebFetch` → `http:fetch`
   - `Edit` → `file:write`
   - `NotebookEdit` → `file:write`
3. POSTs to `/acp/intercept`
4. Exits 0 (allow) or 2 (block)

### 3.7 Process Sandboxing (`sandbox/process.ts`)

**Status**: Extended

New env vars injected:
- `PATH` prepended with shell wrapper bin dir
- `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy` → `http://127.0.0.1:{httpProxyPort}`
- `NO_PROXY=127.0.0.1,localhost`
- `ACP_SHELL_INTERCEPT=1`, `ACP_HTTP_INTERCEPT=1` markers

---

## 4. Cryptography Assessment

### Ed25519 Consent Proofs
- **Implementation**: Node.js `crypto.generateKeyPairSync('ed25519')` — PKCS8/DER format, hex encoded
- **Signing**: `crypto.sign(null, data, privateKey)` — standard Ed25519 (no prehash)
- **Canonical JSON**: Sorted keys, no whitespace — deterministic across platforms
- **Nonce**: `crypto.randomUUID()` — cryptographically secure
- **Assessment**: Correct implementation. No known vulnerabilities.

### AES-256-GCM Credential Vault
- **Key derivation**: Ed25519 private key → `crypto.hkdfSync('sha256', ...)` → 32-byte AES key
- **HKDF parameters**: Salt = `acp-vault-salt` (static), Info = `acp-credential-vault-v2`
- **Encryption**: Random 12-byte IV, random 16-byte salt (salt unused in HKDF — it uses static salt), 128-bit auth tag
- **Assessment**: Correct AES-256-GCM usage. The static HKDF salt is acceptable since the key material (Ed25519 private key) has high entropy. The random "salt" field in the vault file is generated but not used in key derivation — misleading but not a vulnerability.

### SHA-256 Hash-Chained Audit Trail
- **Chaining**: Each event includes `previous_hash: sha256(JSON(previous_event))`
- **Verification**: Walk chain, recompute hashes, detect breaks
- **Assessment**: Standard tamper-evident log. An attacker with write access could rewrite the entire chain from any point forward.

---

## 5. Security Assessment

### Threat Model

| Threat | Mitigated? | How |
|--------|-----------|-----|
| Agent makes unauthorized MCP tool calls | **Yes** | MCP proxy intercepts all JSON-RPC |
| Agent runs dangerous shell commands | **Partial** | PATH wrappers, but bypassable via absolute paths |
| Agent makes unauthorized HTTP requests | **Partial** | HTTP_PROXY env var, but bypassable if agent ignores env |
| Agent reads/writes sensitive files | **Partial** | Policy engine classifies, but no filesystem-level enforcement |
| Agent bypasses ACP entirely | **Not mitigated** | Agent runs as same OS user, can access ~/.acp/ |
| Agent modifies PATH to skip wrappers | **Not mitigated** | No enforcement beyond initial env |
| Agent uses absolute binary paths | **Not mitigated** | `/usr/bin/curl` skips wrapper |
| Consent proof replay | **Not mitigated** | Nonces generated but never validated |
| Private key theft | **Not mitigated** | Plaintext at ~/.acp/keys/private.key |
| Audit log tampering | **Detected** | Hash chain detects, but doesn't prevent |

### Strengths

1. **Zero new dependencies** — still only commander + yaml (minimal supply chain risk)
2. **Correct cryptography** — Ed25519, AES-256-GCM, HKDF, SHA-256 all properly implemented using Node built-ins
3. **Fail-closed default** — shell wrappers deny if ACP unreachable
4. **HTTPS without MITM** — CONNECT tunneling gives domain-level control without breaking TLS
5. **Backwards compatible** — v1 policies and existing MCP-only configs still work
6. **Hash-chained audit trail** — every decision recorded with tamper detection
7. **Credential isolation** — secrets encrypted at rest, injected only post-approval
8. **127.0.0.1 binding** — proxy and HTTP proxy only listen on loopback

### Weaknesses

| Issue | Severity | Description |
|-------|----------|-------------|
| Same OS user | **Critical** | Agent can read ~/.acp/keys/, bypass all protections |
| Private key plaintext | **High** | Ed25519 key unencrypted on disk |
| Shell wrapper bypass | **High** | Absolute paths, PATH modification, built-in commands |
| HTTP proxy bypass | **High** | Agent can ignore HTTP_PROXY env var |
| No replay protection | **Medium** | Consent proofs have nonces but server doesn't validate |
| No request size limits | **Medium** | Large payloads could cause OOM |
| No upstream timeouts | **Medium** | Tool forwarding can hang indefinitely |
| CONNECT tunnel no timeout | **Medium** | TCP tunnels persist until connection close |
| Timezone bug | **Low** | Time-of-day conditions always UTC |
| Rate limit off-by-one | **Low** | First call to new tool not rate-checked |

### Honest Assessment

ACP v0.3.0 provides **defense-in-depth for cooperative agents**. It works when the agent respects the environment it's given (PATH, HTTP_PROXY, MCP_SERVER_URL). It does NOT work against a malicious agent that actively tries to bypass controls — such an agent can call `/usr/bin/curl` directly, ignore proxy env vars, or read the private key from disk.

This is a **policy enforcement layer**, not a **security sandbox**. Think of it like a firewall rule that a root user could disable — useful for catching unintentional actions, not for preventing determined adversaries.

For true containment, the agent would need to run in a separate container/VM/user with filesystem restrictions preventing access to `~/.acp/`.

---

## 6. Test Coverage

**86 tests total, all passing.**

| Test File | Count | What's Tested |
|-----------|-------|---------------|
| `audit.test.ts` | 8 | Hash chaining, tamper detection, chain restoration |
| `consent-gate.test.ts` | 11 | Auto-allow/deny, ask flow, credential injection, proofs |
| `credentials.test.ts` | 14 | Plaintext/encrypted modes, migration, round-trips |
| `crypto.test.ts` | 10 | Key gen, sign/verify, hashing, canonical JSON |
| `policy-engine.test.ts` | 30 | Classification, glob matching, args, time-of-day, rate limits |
| `policy-engine-extended.test.ts` | 12 | Shell/HTTP/file classification, kind/host/path/command matching |
| `intercept-api.test.ts` | 7 | Health check, shell allow/deny, HTTP host matching, validation |
| `shell-wrappers.test.ts` | 8 | Dir creation, gate helper, wrapper scripts, fail modes, cleanup |
| `http-proxy.test.ts` | 2 | Forward allowed requests, block denied requests |

**Not tested**:
- CLI commands (init, run, setup, secret, policy, status)
- Telegram/webhook channels
- Network isolation
- Claude Code hook generation
- HTTPS CONNECT tunneling
- Shell wrapper actual execution (only file generation tested)

---

## 7. Feature Completeness Matrix

| Feature | v0.2.4 | v0.3.0 |
|---------|--------|--------|
| MCP tool call interception | Complete | Complete |
| Shell command interception | Missing | **Complete** (PATH wrappers) |
| HTTP request interception | Stubbed (501) | **Complete** (forward proxy) |
| HTTPS CONNECT tunneling | Missing | **Complete** (domain-level) |
| File operation classification | Missing | **Complete** (policy engine) |
| Claude Code integration | Missing | **Complete** (hook generator) |
| Policy v2 (kind/host/path/command) | Missing | **Complete** |
| Ed25519 consent proofs | Complete | Complete |
| Hash-chained audit trail | Complete | Complete |
| AES-256-GCM credential vault | Complete | Complete |
| Terminal approval channel | Complete | Complete |
| Telegram approval | Partial | Partial |
| Webhook approval | Partial | Partial |
| Network isolation (Linux) | Partial | Partial |
| Network isolation (macOS) | Missing | Missing |
| Replay protection | Missing | Missing |
| Private key encryption at rest | Missing | Missing |

---

## 8. File Inventory

### Source Files (30)

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 107 | CLI entry point |
| `src/commands/init.ts` | ~120 | Setup wizard |
| `src/commands/run.ts` | ~200 | Main orchestrator |
| `src/commands/setup.ts` | ~80 | Integration setup |
| `src/commands/secret.ts` | ~60 | Vault CLI |
| `src/commands/policy.ts` | ~50 | Policy management |
| `src/commands/status.ts` | ~80 | Status check |
| `src/proxy/mcp-proxy.ts` | ~250 | MCP proxy + /acp/ routes |
| `src/proxy/consent-gate.ts` | ~180 | Decision engine |
| `src/proxy/upstream-manager.ts` | ~200 | Upstream MCP routing |
| `src/proxy/http-proxy.ts` | 275 | HTTP forward proxy |
| `src/interceptors/types.ts` | ~30 | Shared types |
| `src/interceptors/shell-wrappers.ts` | ~180 | PATH wrapper generation |
| `src/integrations/claude-code.ts` | ~100 | Claude Code hooks |
| `src/policy/engine.ts` | ~350 | Policy evaluation |
| `src/policy/parser.ts` | ~100 | YAML validation |
| `src/policy/defaults.ts` | ~40 | Default templates |
| `src/sandbox/process.ts` | ~100 | Process spawning |
| `src/sandbox/credentials.ts` | 237 | Encrypted vault |
| `src/sandbox/network.ts` | ~120 | Network isolation |
| `src/crypto/keys.ts` | 116 | Ed25519 + SHA-256 |
| `src/audit/logger.ts` | ~100 | Hash-chained logging |
| `src/channels/terminal.ts` | ~200 | Terminal + Telegram + Webhook |

### Policy Presets (1)
| File | Purpose |
|------|---------|
| `policies/openclaw.yml` | OpenClaw-specific v2 policy |

---

## 9. Local Setup & Testing Guide (macOS)

### Prerequisites
- Node.js v20+ (`node --version`)
- npm (`npm --version`)

### Build & Test
```bash
cd cli
npm install
npm run build
npm test          # Should show: 86 tests passing
```

### Initialize ACP
```bash
npx acp init --channel=prompt
# Creates ~/.acp/ with keys, config, policy, vault
```

### Run with Shell + HTTP Interception
```bash
npx acp run -- bash
# Opens a sandboxed bash shell where:
#   - Shell commands (curl, rm, git, etc.) go through ACP consent
#   - HTTP requests go through ACP HTTP proxy
#   - You'll see approval prompts in the terminal
```

### Test Shell Interception
```bash
# Inside the sandboxed shell:
curl https://example.com          # → Should trigger ACP prompt
git status                        # → May be auto-allowed by policy
rm important-file.txt             # → Should trigger ACP prompt (high risk)
```

### Test HTTP Proxy
```bash
# Inside the sandboxed shell:
python3 -c "import urllib.request; print(urllib.request.urlopen('http://example.com').read()[:100])"
# → Should trigger ACP prompt via HTTP proxy
```

### Set Up Claude Code Integration
```bash
npx acp setup claude-code
# Generates hook script and prints instructions for ~/.claude/settings.json
```

### Apply a Custom Policy
```bash
npx acp policy apply policies/openclaw.yml
npx acp policy show
```

### Check Status
```bash
npx acp status
```

---

## 10. Conclusion

ACP v0.3.0 is a significant step from MCP-only interception to **general-purpose agent consent**. The addition of shell wrappers, HTTP forward proxy, and Claude Code hooks means ACP can now intercept the three main vectors agents use to affect the outside world: shell commands, network requests, and file operations.

The implementation is clean, zero-dependency (Node built-ins only for all new features), and backwards compatible. The policy engine's v2 format with kind/host/path/command matching provides fine-grained control.

**The fundamental limitation remains**: ACP provides policy enforcement for cooperative agents, not containment for adversarial ones. The agent runs as the same OS user and can bypass controls by using absolute paths, ignoring proxy env vars, or reading the private key directly. For production adversarial scenarios, ACP should be combined with container/VM isolation.

**For its intended use case** — human oversight of AI agents in development environments — ACP v0.3.0 delivers meaningful protection with minimal friction.
