# Release Readiness Assessment (`v0.3.0`)

Date: 2026-02-22

## Scope Reviewed

1. Linux VM install/start flow for OpenClaw mode
2. Startup/runtime correctness changes in:
   - `cli/src/cli/start.ts`
   - `cli/src/core/gate.ts`
   - `cli/src/core/channel.ts`
   - `cli/src/vm/nftables.ts`
3. Test coverage and automation health
4. Documentation/security/threat model alignment with current code behavior
5. Basic dependency security scan (`npm audit --omit=dev`)

## Evidence

### Automated Tests

- `cd cli && npm run build && npm test`
- Result: pass (`63/63`)
- Added new suites:
  - `cli/src/tests/start-lock.test.ts`
  - `cli/src/tests/start-utils.test.ts`

### Dependency Audit

- `cd cli && npm audit --omit=dev`
- Result: `found 0 vulnerabilities`

### VM Deployment Validation

Repeated wipe + fresh install runs verified:

1. `acp --version` resolves to `0.3.0`
2. `acp start openclaw --openclaw-user=openclaw` starts ACP + gateway
3. nftables table `inet acp_vm_v030` present
4. startup lock prevents duplicate supervisors
5. agent auth directory ownership remains under `openclaw:openclaw`
6. host approval cache behavior works (`google.com` approval then `www.google.com` cached allow)

## What Is Production-Strong

1. Core consent gate and policy behavior
2. Linux VM egress mediation with nftables
3. Duplicate-start prevention via startup lock
4. Repeatability of clean install when prerequisites are present
5. Documentation now aligned to VM-first `v0.3.x` model (security + threat model updated)

## Remaining Risks / Blockers

1. **`openclaw@latest` at runtime is not deterministic**
   - First-run startup can change behavior over time and may pull native builds.
   - Operational risk for reproducibility and incident response.

2. **Default config/policy path remains user-writable**
   - `/home/openclaw/.acp` tamper risk if runtime user is compromised.
   - Stronger default hardening profile is not yet enforced automatically.

3. **No formal third-party security audit**
   - Current assurance is internal testing + operational validation.

## Release Recommendation

### Decision: **Conditional Go**

Suitable for:
- official `v0.3.0` release as **experimental/ops-ready Linux VM mode**
- controlled production environments with explicit operator hardening

Not yet suitable for:
- “high-assurance” official security-hardened release claim

## Required Follow-up for Harder GA Posture

1. Pin OpenClaw dependency version in startup flow (or pre-bake workspace artifacts).
2. Provide hardened install profile by default:
   - root-owned config/policy paths
   - root-owned state/log paths
   - systemd unit template as primary path
3. Add automated VM smoke job in CI (fresh VM install/start/consent flow).
4. Run independent security review before claiming hardened production grade.
