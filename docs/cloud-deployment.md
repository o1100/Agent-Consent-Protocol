# Cloud Deployment

For production, deploy ACP in the cloud with proper network isolation using infrastructure-as-code.

> **v0.3 architecture:** ACP runs on the host (or a host VM/container with internet access). Agent containers connect to ACP's consent server (:8443) and HTTP proxy (:8444). The agent container has no direct internet access — all traffic flows through ACP.

## Azure (Container Instances + NSG)

See [examples/terraform/azure/main.tf](../examples/terraform/azure/main.tf) for the full Terraform configuration.

**Architecture:**
```
┌─────────────────────────────────────────────┐
│              Azure Resource Group            │
│                                              │
│  ┌──────────┐  NSG (internal only)           │
│  │  Agent   │◄──────────────────────┐        │
│  │  ACI     │  No internet egress   │        │
│  └──────────┘                       │        │
│                                     │        │
│  ┌──────────┐  NSG (internet OK)    │        │
│  │  ACP     │───────────────────────┘        │
│  │  Host VM │  :8443 consent server          │
│  └──────────┘  :8444 HTTP proxy              │
│                + Telegram API                │
│                                              │
└──────────────────────────────────────────────┘
```

**Quick deploy:**
```bash
cd examples/terraform/azure
terraform init
terraform apply \
  -var="telegram_token=xxx" \
  -var="telegram_chat_id=yyy"
```

On the ACP host:
```bash
acp init --channel=telegram
acp contain -- python my_agent.py
```

## AWS (Fargate + Security Groups)

See [examples/terraform/aws/main.tf](../examples/terraform/aws/main.tf) for the full Terraform configuration.

**Architecture:**
```
┌─────────────────────────────────────────────┐
│                   VPC                        │
│                                              │
│  ┌──────────┐  SG: egress to ACP only       │
│  │  Agent   │◄──────────────────────┐        │
│  │  Fargate │  No internet          │        │
│  └──────────┘                       │        │
│                                     │        │
│  ┌──────────┐  SG: egress allowed   │        │
│  │  ACP     │───────────────────────┘        │
│  │  Host    │  :8443 consent server          │
│  └──────────┘  :8444 HTTP proxy              │
│                NAT Gateway                   │
│                                              │
└──────────────────────────────────────────────┘
```

**Quick deploy:**
```bash
cd examples/terraform/aws
terraform init
terraform apply \
  -var="telegram_token=xxx" \
  -var="telegram_chat_id=yyy"
```

On the ACP host:
```bash
acp init --channel=telegram
acp contain -- python my_agent.py
```

## Key Considerations

1. **Network isolation is the foundation.** The agent container must not have internet access — all traffic goes through ACP's proxy.
2. **ACP needs internet** for Telegram API and to forward approved HTTP requests.
3. **Two ports:** ACP exposes :8443 (consent server for shell wrappers) and :8444 (HTTP proxy for all network traffic).
4. **Container hardening:** Use `--read-only`, `--cap-drop=ALL`, and `--no-new-privileges` on agent containers, just as `acp contain` does locally.
5. **Monitoring:** Send audit logs to your SIEM/logging system.
6. **High availability:** Run multiple ACP instances behind a load balancer for production workloads.
