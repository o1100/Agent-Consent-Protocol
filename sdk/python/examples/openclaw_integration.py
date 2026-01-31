"""
ACP + OpenClaw Integration

An OpenClaw agent using ACP for consent. To get Telegram approvals,
just set two env vars before running:

    export ACP_TELEGRAM_TOKEN="your-bot-token"
    export ACP_TELEGRAM_CHAT_ID="your-chat-id"
    python openclaw_integration.py

Without those env vars, falls back to terminal prompts.
"""

from acp import requires_consent, ConsentDeniedError


@requires_consent("high", category="public",
                  estimated_impact="Visible to all followers")
def send_tweet(text: str) -> dict:
    """Post a tweet to the configured Twitter account."""
    print(f"🐦 Tweeting: {text}")
    return {"tweet_id": "12345", "url": "https://twitter.com/..."}


@requires_consent("high")
def send_email(to: str, subject: str, body: str) -> dict:
    """Send an email."""
    print(f"📧 Sending to {to}: {subject}")
    return {"status": "sent"}


@requires_consent("high")
def execute_shell(command: str) -> dict:
    """Execute a shell command."""
    import subprocess
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    return {"stdout": result.stdout, "exit_code": result.returncode}


@requires_consent("critical", category="financial")
def make_purchase(item: str, amount: float, vendor: str) -> dict:
    """Purchase with company credit card."""
    print(f"💳 Purchasing {item} from {vendor} for ${amount}")
    return {"order_id": "ORD-001"}


if __name__ == "__main__":
    print("🤖 Clawd Agent — ACP Demo\n")

    for action in [
        lambda: send_tweet("Just shipped v2.0! 🚀"),
        lambda: send_email("client@co.com", "Status Update", "On track."),
        lambda: execute_shell("echo 'Hello from ACP!'"),
    ]:
        try:
            result = action()
            print(f"  ✅ {result}\n")
        except ConsentDeniedError as e:
            print(f"  ❌ Denied: {e}\n")
