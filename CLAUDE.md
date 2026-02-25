# CLAUDE.md

This file provides guidance for AI agents working on the Agent Consent Protocol (ACP) codebase.

## Project Overview

ACP is an open standard for human authorization of AI agent actions. v0.3.0 is VM-first: it runs agents on Linux VMs with nftables egress rules, gating outbound HTTP/HTTPS through a local consent proxy. Legacy Docker container mode (`acp contain`) is still available.

**Key concepts:**
- **Consent Gate** — Decision engine: `(action) => Promise<verdict>`
- **Policy Engine** — YAML rules: allow, ask, deny
- **Channels** — Human notification: Telegram, terminal, webhook
- **HTTP proxy interception** — Consent-gated forward proxy on loopback
- **nftables egress control** — Per-user fail-closed outbound rules (VM mode)
- **Container isolation** — Read-only filesystem, `--internal` network (legacy `acp contain`)

## Directory Structure

```
cli/                    # Main TypeScript CLI package
  src/
    core/               # Protocol core (~300 lines)
      types.ts          # Action, Verdict, PolicyRule
      gate.ts           # createGate() — consent decision engine
      policy.ts         # YAML policy engine + glob matching
      channel.ts        # TelegramChannel, WebhookChannel, PromptChannel
      audit.ts          # FileAuditLog — append-only JSONL
    container/          # Container enforcement (~600 lines)
      docker.ts         # Docker network + container orchestration
      http-proxy.ts     # HTTP forward proxy (consent-gated)
      shell-wrappers.ts # Generate wrapper scripts (Layer 1)
      consent-server.ts # HTTP server for wrapper callbacks
    vm/                 # VM-mode enforcement (v0.3.0)
      nftables.ts       # Per-user nftables egress rules
      start-lock.ts     # PID lock for acp start
    cli/                # CLI commands
      init.ts           # acp init
      contain.ts        # acp contain -- <command>
      start.ts          # acp start <preset> (VM mode)
    tests/              # Node.js built-in test runner
policies/               # Policy YAML presets
templates/              # Container templates
docs/                   # Documentation site
```

## Development Commands

```bash
# Build and test (from cli/ directory)
cd cli
npm install
npm run build          # TypeScript compile
npm test               # Run all tests (63 tests)

# Development mode
npm run dev            # Watch mode compilation
```

## Code Conventions

### TypeScript

- **Strict mode enabled** — All strict checks on
- **ES2022 target** — Use modern JS features
- **ES Modules** — Use `.js` extensions in imports: `import { foo } from './foo.js'`
- **Node16 module resolution** — Required for ESM

### Dependencies

- **Minimize external deps** — Only `commander` and `yaml` in production
- **Prefer Node.js built-ins** — Use `node:http`, `node:crypto`, `node:fs` over npm packages
- **No runtime type checking libs** — TypeScript types only

### Style

- Explicit return types on exported functions
- Use `type` imports: `import type { Foo } from './foo.js'`
- Descriptive variable names over comments
- One concept per file in `core/`

## Useful References

- [SPEC.md](SPEC.md) — Full protocol specification
- [SECURITY.md](SECURITY.md) — Security model and limitations
- [THREAT-MODEL.md](THREAT-MODEL.md) — Known attack vectors
- [docs/how-it-works.md](docs/how-it-works.md) — Architecture deep dive
- [docs/policy-reference.md](docs/policy-reference.md) — Policy YAML syntax
