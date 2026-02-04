# OpenClaw + ACP

Run OpenClaw with ACP consent enforcement:

```bash
# Initialize ACP with Telegram
acp init --channel=telegram

# Run OpenClaw through ACP
acp contain -- openclaw gateway
```

OpenClaw runs inside a Docker container with no direct internet access. All shell commands and HTTP requests go through ACP's consent gate. Approve or deny from your phone.

## Manual Docker Setup

For custom deployments, use docker compose:

```yaml
services:
  agent:
    image: ghcr.io/o1100/openclaw:latest
    environment:
      - HTTP_PROXY=http://host.docker.internal:8444
      - HTTPS_PROXY=http://host.docker.internal:8444
      - ACP_CONSENT_URL=http://host.docker.internal:8443
    networks: [isolated]

networks:
  isolated:
    internal: true
```
