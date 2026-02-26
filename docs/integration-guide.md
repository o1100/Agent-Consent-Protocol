# Integration Guide (`v0.3.0`)

ACP `v0.3.0` has two execution paths:

1. `acp start openclaw` (primary, Linux VM OpenClaw mode)
2. `acp contain -- <command>` (legacy Docker compatibility mode)

## Primary Path: OpenClaw on Linux VM

### 0) Host prerequisites

```bash
sudo apt-get update -y
sudo apt-get install -y nftables build-essential
```

### 1) Ensure runtime user exists

```bash
sudo useradd -m -s /bin/bash openclaw || true
```

### 2) Configure ACP and OpenClaw as that user

```bash
sudo -u openclaw -H acp init --channel=telegram
```

Wizard output:

- `/home/openclaw/.acp/config.yml`
- `/home/openclaw/.acp/policy.yml`
- optional `/home/openclaw/.openclaw/openclaw.json`

### 3) Start VM mode

```bash
sudo acp start openclaw --openclaw-user=openclaw
```

Behavior:

- installs/updates OpenClaw in workspace
- starts ACP proxy and consent gate
- installs nftables egress rules for OpenClaw user
- runs OpenClaw gateway under that user

### 4) Verify

```bash
sudo -u openclaw -H tail -f /home/openclaw/.acp/audit.jsonl
```

Trigger an external request from OpenClaw and confirm consent prompt appears.

## Policy Notes

- Policy is evaluated for outbound HTTP actions.
- Built-in safe host allowlist is prepended at startup for common provider endpoints.
- Host approval cache exists for recent allow decisions (configurable via env).

See [policy-reference.md](./policy-reference.md) for schema.

## Legacy Path: `acp contain`

`acp contain` remains available for Docker-based wrapping of generic agents.

Use it when:

- you need quick compatibility for non-OpenClaw commands
- you are not deploying the Linux VM OpenClaw pattern

Do not treat `acp contain` as the primary production path for `v0.3.0`.
