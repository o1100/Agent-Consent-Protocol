# ACP v0.3.0 Design: Linux VM Mode for OpenClaw

Status: Implemented in repo (current architecture)

## Objective

Provide simple, reliable human consent gating for OpenClaw on Linux cloud VMs with minimal moving parts.

## Core Decisions

1. Prioritize one deployment shape: OpenClaw on Linux VM
2. Keep local file CRUD available to OpenClaw workspace
3. Enforce outbound network mediation (or block)
4. Use external-device consent channel (Telegram/webhook/prompt)
5. Keep deny-on-failure behavior

## Architecture

### Process Roles

- ACP main process (root):
  - starts consent-gated HTTP proxy
  - installs/removes nftables egress rules
  - launches OpenClaw gateway under target user UID/GID
- OpenClaw gateway (non-root `openclaw` user)

### Enforcement Path

1. OpenClaw issues outbound request
2. nftables rules constrain egress for OpenClaw UID
3. traffic is mediated by ACP proxy path
4. ACP evaluates policy and channel consent
5. ACP forwards or denies

## Security Properties (Current)

Implemented:

- non-root OpenClaw runtime
- root-required startup for nftables rule management
- fail-closed egress behavior for constrained user traffic
- append-only audit log writes

Not fully hardened by default yet:

- policy/config under OpenClaw home are writable by that user
- root-owned `/etc/acp` + `/var/*/acp` deployment layout is not yet the default runtime path

## Why This Direction

Compared with the Docker-first path, VM mode removes complexity from:

- container network orchestration
- shell-wrapper dependency chains
- command-vs-network split in common OpenClaw workflows

The result is simpler operational behavior for the target use case.

## Scope Boundaries

In scope for v0.3.0:

- Linux VMs
- OpenClaw preset startup
- outbound HTTP/HTTPS consent mediation

Out of scope for v0.3.0:

- macOS/Windows VM-mode parity
- complete host immutability controls
- multi-tenant host scheduling

## Legacy Compatibility

`acp contain` Docker mode remains in the repo for compatibility, but is no longer the primary architecture for OpenClaw deployments in v0.3.0.
