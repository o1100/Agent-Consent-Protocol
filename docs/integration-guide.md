# Integration Guide

ACP wraps processes — not frameworks. Any agent that runs as a command can be sandboxed with `acp run`.

## OpenClaw

```bash
acp run -- openclaw gateway
```

OpenClaw's MCP tool calls will be intercepted by ACP. No code changes needed.

## LangChain (Python)

```bash
acp run -- python langchain_agent.py
```

If your LangChain agent uses MCP tools, ACP will intercept them transparently. For LangChain agents using native tool calls, set `ACP_PROXY_URL` as the MCP server endpoint.

```python
# langchain_agent.py
import os
from langchain_mcp import MCPToolkit

# ACP injects this automatically
mcp_url = os.environ.get("ACP_PROXY_URL", "http://localhost:8443")
toolkit = MCPToolkit(server_url=mcp_url)
```

## AutoGen

```bash
acp run -- python autogen_script.py
```

AutoGen agents that use MCP will route through ACP automatically.

## CrewAI

```bash
acp run -- python crew.py
```

Same approach — ACP wraps the process, intercepts MCP calls.

## Custom Agents (Any Language)

ACP works with any agent that can make HTTP requests to an MCP server:

```bash
# Node.js
acp run -- node my_agent.js

# Go
acp run -- ./my-go-agent

# Rust
acp run -- ./my-rust-agent

# Java
acp run -- java -jar agent.jar
```

Your agent just needs to connect to the MCP server at `ACP_PROXY_URL`:

```python
# Python example
import os, json, requests

proxy_url = os.environ["ACP_PROXY_URL"]

# Make a tool call through ACP
response = requests.post(proxy_url, json={
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "send_email",
        "arguments": {
            "to": "boss@company.com",
            "subject": "Report"
        }
    }
})

result = response.json()
# If the human approved, result contains the tool output
# If denied, result contains an error
```

## Docker

For production, use Docker Compose for proper network isolation:

```bash
# Copy the example
cp examples/docker-compose.yml .

# Set your credentials
export TELEGRAM_TOKEN=xxx
export CHAT_ID=yyy

# Run
docker compose up
```

See [examples/docker-compose.yml](../examples/docker-compose.yml).

## Environment Variables

ACP injects these into the agent process:

| Variable | Value | Description |
|---|---|---|
| `ACP_PROXY_URL` | `http://127.0.0.1:8443` | MCP proxy address |
| `MCP_SERVER_URL` | `http://127.0.0.1:8443` | Alias for MCP SDK compat |
| `ACP_SANDBOX` | `1` | Indicates running inside ACP |
| `ACP_VERSION` | `0.1.0` | ACP version |

ACP also **strips** any environment variables that match vault secret keys, ensuring the agent never has direct access to credentials.
