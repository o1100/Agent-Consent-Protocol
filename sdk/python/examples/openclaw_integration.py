"""
ACP + OpenClaw Integration Example

Shows how an OpenClaw agent can use ACP to get human consent
before performing consequential actions.

The agent runs on a VM; the human approves via Telegram.
"""

import asyncio
from acp import ACPClient, requires_consent, ConsentDenied, ConsentTimeout


# ─── Initialize ACP ──────────────────────────────────────────────

client = ACPClient(
    gateway_url="http://localhost:3000",  # ACP Gateway
    agent_id="clawd_main",
    agent_name="Clawd",
    agent_framework="openclaw",
    session_id="session_001",
)


# ─── Protected Tools ─────────────────────────────────────────────

@requires_consent(client, category="public", risk_level="high",
                  estimated_impact="Visible to all followers")
async def send_tweet(text: str, media_urls: list[str] | None = None) -> dict:
    """Post a tweet to the configured Twitter account."""
    print(f"🐦 Tweeting: {text}")
    return {"tweet_id": "12345", "url": "https://twitter.com/..."}


@requires_consent(client, category="communication", risk_level="high")
async def send_email(to: str, subject: str, body: str) -> dict:
    """Send an email."""
    print(f"📧 Sending email to {to}: {subject}")
    return {"status": "sent", "message_id": "msg_001"}


@requires_consent(client, category="system", risk_level="high")
async def execute_shell(command: str) -> dict:
    """Execute a shell command."""
    import subprocess
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.returncode,
    }


@requires_consent(client, category="financial", risk_level="critical",
                  description="Purchase items with company credit card")
async def make_purchase(item: str, amount: float, vendor: str) -> dict:
    """Make a purchase."""
    print(f"💳 Purchasing {item} from {vendor} for ${amount}")
    return {"order_id": "ORD-001", "amount": amount}


# ─── Agent Workflow ───────────────────────────────────────────────

async def agent_workflow():
    """
    Simulates an OpenClaw agent performing various actions.
    Each consequential action requires human consent via Telegram.
    """
    print("🤖 Clawd Agent — ACP Demo")
    print("=" * 50)
    print()

    # Scenario 1: Tweet about a product launch
    print("📋 Scenario 1: Post a tweet")
    try:
        result = await send_tweet(
            text="Just shipped v2.0 of our product! 🚀 Check it out at example.com"
        )
        print(f"   ✅ Tweet posted: {result}")
    except ConsentDenied as e:
        print(f"   ❌ Tweet denied: {e.reason}")
    except ConsentTimeout:
        print("   ⏰ No response — tweet not posted")

    print()

    # Scenario 2: Send an email to a client
    print("📋 Scenario 2: Send client email")
    try:
        result = await send_email(
            to="client@example.com",
            subject="Weekly Status Update",
            body="All milestones are on track for the Q3 deadline.",
        )
        print(f"   ✅ Email sent: {result}")
    except ConsentDenied as e:
        print(f"   ❌ Email denied: {e.reason}")

    print()

    # Scenario 3: Deploy to production
    print("📋 Scenario 3: Shell command")
    try:
        result = await execute_shell(command="echo 'Hello from ACP!'")
        print(f"   ✅ Command executed: {result}")
    except ConsentDenied as e:
        print(f"   ❌ Command denied: {e.reason}")

    await client.close()


if __name__ == "__main__":
    asyncio.run(agent_workflow())
