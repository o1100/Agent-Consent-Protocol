#!/usr/bin/env python3
"""
Test agent for ACP proxy.
Connects to ACP via HTTP JSON-RPC, lists tools, and calls them.
"""

import json
import os
import sys
import urllib.request
import time

PROXY_URL = os.environ.get("ACP_PROXY_URL", "http://127.0.0.1:8443")

def rpc_call(method, params=None, req_id=None):
    """Send a JSON-RPC request to ACP proxy."""
    if req_id is None:
        req_id = int(time.time() * 1000)
    
    payload = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": method,
    }
    if params is not None:
        payload["params"] = params
    
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        PROXY_URL,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        print(f"  [agent] Connection error: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [agent] Error: {e}", file=sys.stderr)
        return None


def main():
    print("[agent] Starting test agent...")
    print(f"[agent] Proxy URL: {PROXY_URL}")
    print()
    
    # Step 1: Initialize
    print("[agent] Step 1: Initialize MCP connection")
    resp = rpc_call("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "test-agent", "version": "1.0"},
    }, req_id=1)
    if resp and resp.get("result"):
        print(f"  Server: {resp['result'].get('serverInfo', {})}")
        print("  ✅ Initialize OK")
    else:
        print(f"  ❌ Initialize failed: {resp}")
        sys.exit(1)
    print()
    
    # Send initialized notification
    rpc_call("notifications/initialized", {}, req_id=2)
    
    # Step 2: List tools
    print("[agent] Step 2: List tools")
    resp = rpc_call("tools/list", {}, req_id=3)
    if resp and resp.get("result"):
        tools = resp["result"].get("tools", [])
        print(f"  Found {len(tools)} tool(s):")
        for t in tools:
            desc = t.get("description", "")[:60]
            print(f"    - {t['name']}: {desc}")
        print("  ✅ Tools listed")
    else:
        print(f"  ❌ Tools list failed: {resp}")
        sys.exit(1)
    print()
    
    # Step 3: Test read_file (should auto-approve per policy — category: read)
    print("[agent] Step 3: Call read_file (should auto-approve)")
    # First create a test file
    test_file = "/tmp/acp-test-file.txt"
    with open(test_file, "w") as f:
        f.write("Hello from ACP test!\nLine 2\nLine 3\n")
    
    resp = rpc_call("tools/call", {
        "name": "read_file",
        "arguments": {"path": test_file},
    }, req_id=4)
    if resp:
        if resp.get("result"):
            content = resp["result"]
            print(f"  Result: {json.dumps(content)[:200]}")
            print("  ✅ read_file OK")
        elif resp.get("error"):
            print(f"  ❌ read_file error: {resp['error']}")
        else:
            print(f"  ❓ Unexpected response: {resp}")
    print()
    
    # Step 4: Test list_directory (should auto-approve — category: read)
    print("[agent] Step 4: Call list_directory (should auto-approve)")
    resp = rpc_call("tools/call", {
        "name": "list_directory",
        "arguments": {"path": "/tmp"},
    }, req_id=5)
    if resp:
        if resp.get("result"):
            content = resp["result"]
            text = json.dumps(content)
            print(f"  Result: {text[:200]}...")
            print("  ✅ list_directory OK")
        elif resp.get("error"):
            print(f"  ❌ list_directory error: {resp['error']}")
    print()
    
    # Step 5: Test write_file (should require consent — category: write)
    print("[agent] Step 5: Call write_file (should require consent)")
    resp = rpc_call("tools/call", {
        "name": "write_file",
        "arguments": {
            "path": "/tmp/acp-test-write.txt",
            "content": "Written by ACP test agent!"
        },
    }, req_id=6)
    if resp:
        if resp.get("result"):
            print(f"  Result: {json.dumps(resp['result'])[:200]}")
            print("  ✅ write_file OK (approved)")
        elif resp.get("error"):
            print(f"  ⛔ write_file denied: {resp['error']['message']}")
            print("  ✅ Consent gate working correctly")
    print()
    
    # Step 6: Ping
    print("[agent] Step 6: Ping")
    resp = rpc_call("ping", req_id=7)
    if resp and resp.get("result") is not None:
        print("  ✅ Ping OK")
    print()
    
    print("[agent] All tests complete!")
    print()


if __name__ == "__main__":
    main()
