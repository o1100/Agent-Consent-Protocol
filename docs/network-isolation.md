# Network Isolation

> **Note:** Network isolation is **optional** and **not enabled by default**. It requires root access or Docker. Without it, ACP operates in proxy-only mode — MCP tool calls are intercepted, but the agent can make direct network requests that bypass ACP.

When enabled, ACP restricts agent network access so it can only communicate with the ACP proxy. This is the strongest form of enforcement — even a compromised agent cannot bypass consent gates.

## Strategies by Platform

### Linux with Root (iptables)

The strongest non-Docker isolation. ACP creates iptables rules that restrict the agent process:

```bash
# What ACP does under the hood:
iptables -N ACP_SANDBOX_<pid>
iptables -A ACP_SANDBOX_<pid> -o lo -p tcp --dport 8443 -j ACCEPT  # Allow ACP proxy
iptables -A ACP_SANDBOX_<pid> -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A ACP_SANDBOX_<pid> -j DROP  # Drop everything else
iptables -I OUTPUT 1 -m owner --pid-owner <pid> -j ACP_SANDBOX_<pid>
```

**Usage:**
```bash
sudo acp run --network-isolation -- python my_agent.py
```

**Pros:** Strong isolation, no Docker needed
**Cons:** Requires root, Linux only

### Docker (Recommended for Production)

The most portable strong isolation. The agent runs in a container with no internet access:

```yaml
# docker-compose.yml
services:
  acp:
    image: ghcr.io/o1100/acp:latest
    networks: [isolated, internet]
    ports: ["127.0.0.1:8443:8443"]

  agent:
    image: your-agent
    environment:
      ACP_PROXY_URL: http://acp:8443
    networks: [isolated]  # NO internet

networks:
  isolated:
    internal: true  # No external access
  internet:         # ACP can reach the internet
```

**Pros:** Cross-platform, battle-tested isolation
**Cons:** Requires Docker

### Linux Rootless (LD_PRELOAD) — Future

For environments where you can't use root or Docker:

```bash
acp run --isolation=preload -- python my_agent.py
```

ACP injects a shared library that intercepts `connect()` syscalls and only allows connections to the ACP proxy port.

**Pros:** No root required
**Cons:** Can be bypassed by statically linked binaries

### macOS (pf Firewall) — Future

```bash
sudo acp run --network-isolation -- python my_agent.py
```

Uses macOS packet filter to restrict outbound traffic.

### Cloud VMs (NSG/Security Groups)

For production deployments, use cloud networking:

**Azure:** Network Security Group allowing only internal traffic + ACP port
**AWS:** Security Group with egress restricted to ACP endpoint
**GCP:** Firewall rules limiting egress

See [Cloud Deployment](cloud-deployment.md) for Terraform examples.

### Fallback: No Isolation

If none of the above are available, ACP runs in proxy-only mode:

```bash
acp run -- python my_agent.py
# ⚠️  Warning: No network isolation. Agent can bypass ACP proxy.
```

The proxy still intercepts MCP tool calls, but the agent could theoretically make direct HTTP requests. Use this for development only.

## Checking Isolation Status

```bash
acp status
# Network: 🔒 Isolated (iptables)
# Network: 🔒 Isolated (Docker)
# Network: ⚠️  No isolation (proxy-only)
```

## Recommendations

| Environment | Recommendation |
|---|---|
| Production | Docker or Cloud NSG |
| Development (Linux) | iptables with sudo |
| Development (macOS) | Docker |
| Quick testing | Proxy-only (no isolation) |
