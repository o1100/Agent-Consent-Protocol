"""
ACP + OpenClaw Integration Example.

Shows how an OpenClaw agent can use ACP for consent on sensitive actions.
The agent routes approvals through Telegram (Tier 2) or a gateway (Tier 3).
"""

import os
from acp import ACPClient, requires_consent, ConsentDeniedError

# ─── Tier 2: Direct Telegram (set env vars) ─────────────────────────
# export ACP_TELEGRAM_TOKEN="your-bot-token"
# export ACP_TELEGRAM_CHAT_ID="your-chat-id"

# ─── Tier 3: Gateway mode ───────────────────────────────────────────
# export ACP_GATEWAY_URL="http://localhost:3000"
# export ACP_GATEWAY_API_KEY="your-api-key"

client = ACPClient(
    agent_id="openclaw-agent",
    agent_name="Clawd",
    framework="openclaw",
    auto_approve_low_risk=True,  # Skip prompts for low-risk actions
)


@requires_consent("high")
def send_message_to_user(platform: str, user: str, message: str):
    """Send a message to a user on an external platform."""
    print(f"📨 Sent to {user} on {platform}: {message}")
    return {"sent": True}


@requires_consent("critical")
def deploy_to_production(service: str, version: str):
    """Deploy a service to production."""
    print(f"🚀 Deployed {service} v{version} to production")
    return {"deployed": True, "service": service, "version": version}


@requires_consent("high")
def execute_shell_command(command: str):
    """Execute a shell command on the host system."""
    print(f"⚙️ Executing: {command}")
    # Would actually run the command here
    return {"output": "command executed"}


# ─── Agentic workflow example ────────────────────────────────────────

def agent_workflow():
    """Simulate an agent workflow with consent gates."""
    print("🤖 Agent starting workflow...\n")

    # Step 1: Low-risk action (auto-approved)
    response = client.request_consent(
        tool="web_search",
        description="Search for deployment best practices",
        parameters={"query": "kubernetes rolling update best practices"},
        risk_level="low",
    )
    print(f"Search: {'✅ auto-approved' if response.auto_approved else response.decision.value}\n")

    # Step 2: High-risk action (requires consent)
    print("Agent wants to deploy to production...")
    try:
        deploy_to_production(service="api-gateway", version="2.1.0")
    except ConsentDeniedError:
        print("❌ Deployment blocked by human.\n")

    # Step 3: Another high-risk action
    print("Agent wants to send a notification...")
    try:
        send_message_to_user(
            platform="slack",
            user="#engineering",
            message="Deployment complete! 🎉",
        )
    except ConsentDeniedError:
        print("❌ Message blocked by human.\n")


if __name__ == "__main__":
    print("=" * 60)
    print("  ACP + OpenClaw Example")
    print(f"  Mode: {client.mode}")
    print("=" * 60)
    print()
    agent_workflow()
