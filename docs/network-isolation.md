# Network Isolation (`v0.3.0`)

ACP `v0.3.0` network isolation is centered on Linux VM mode for OpenClaw.

## Linux VM Mode (Primary)

When started with:

```bash
sudo acp start openclaw --openclaw-user=openclaw
```

ACP applies nftables rules tied to the OpenClaw UID:

- allow TCP to ACP local proxy on loopback
- allow DNS to configured resolver IPs
- reject other outbound traffic for that user

Result: OpenClaw outbound traffic is mediated by ACP policy gate or blocked.

## Fail-Closed Behavior

If ACP proxy/gate is unavailable, OpenClaw does not regain direct internet access through nftables bypass. Traffic is denied by default enforcement path.

## Legacy Docker Mode (`acp contain`)

`acp contain` still provides Docker-based interception for compatibility workflows.

It is not the primary security posture for `v0.3.0` OpenClaw deployments.

## Platform Scope

- Linux VM: supported and recommended for `v0.3.0`
- macOS/Windows VM-mode parity: not implemented in `v0.3.0`
