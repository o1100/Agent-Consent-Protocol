# Cloud Deployment

For production, deploy ACP in the cloud with proper network isolation using infrastructure-as-code.

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
│  │  ACI     │  Egress to internet            │
│  └──────────┘  + Telegram API                │
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
│  │  Fargate │  NAT Gateway                   │
│  └──────────┘                                │
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

## Key Considerations

1. **Network isolation is the foundation.** The agent container must not have internet access.
2. **ACP needs internet** for Telegram API and upstream MCP servers.
3. **Secrets management:** Use cloud-native secret stores (Azure Key Vault, AWS Secrets Manager) instead of the local vault in production.
4. **Monitoring:** Send audit logs to your SIEM/logging system.
5. **High availability:** Run multiple ACP instances behind a load balancer for production workloads.
