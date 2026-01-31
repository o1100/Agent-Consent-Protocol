"""
LangChain agent running through ACP.

Usage:
    acp run -- python agent.py

The ACP_PROXY_URL environment variable is automatically set by `acp run`.
All MCP tool calls go through ACP for consent checking.
"""

import os
import json
import requests

# ACP injects this when running under `acp run`
ACP_PROXY_URL = os.environ.get("ACP_PROXY_URL", "http://localhost:8443")


def call_tool(tool_name: str, arguments: dict) -> dict:
    """Call an MCP tool through the ACP proxy."""
    response = requests.post(
        ACP_PROXY_URL,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        },
    )
    return response.json()


def main():
    print("LangChain agent starting...")
    print(f"ACP Proxy: {ACP_PROXY_URL}")

    # Example: try to send an email (will require consent)
    result = call_tool(
        "send_email",
        {
            "to": "boss@company.com",
            "subject": "Quarterly Report",
            "body": "Please find the quarterly report attached.",
        },
    )

    if "error" in result:
        print(f"Tool call denied: {result['error']['message']}")
    else:
        print(f"Tool call result: {json.dumps(result['result'], indent=2)}")


if __name__ == "__main__":
    main()
