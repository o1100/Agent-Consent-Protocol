"""
ACP Basic Usage — The simplest possible example.

Run: python basic_usage.py

No config, no server, no dependencies. Just a terminal prompt.
"""

from acp import requires_consent, ACPClient, ConsentDeniedError

# ─── Example 1: Decorator (simplest) ────────────────────────────────


@requires_consent("high")
def send_email(to: str, subject: str, body: str):
    """Send an email to someone."""
    print(f"📧 Email sent to {to}: {subject}")
    return {"status": "sent", "to": to}


@requires_consent("critical")
def transfer_money(to_account: str, amount: float, currency: str = "USD"):
    """Transfer money to an external account."""
    print(f"💰 Transferred {currency} {amount} to {to_account}")
    return {"status": "completed", "amount": amount}


@requires_consent  # defaults to "medium" risk
def delete_file(path: str):
    """Delete a file from the filesystem."""
    print(f"🗑️  Deleted {path}")


# ─── Example 2: Client (more control) ───────────────────────────────


def example_with_client():
    client = ACPClient(agent_id="my-agent", agent_name="My AI Assistant")

    response = client.request_consent(
        tool="send_tweet",
        description="Post a tweet about the product launch",
        parameters={"text": "We just shipped v2.0! 🚀"},
        risk_level="high",
        category="public",
        estimated_impact="Visible to 50K+ followers",
    )

    if response.approved:
        print("✅ Tweet approved! Posting...")
    else:
        print(f"❌ Tweet denied: {response.reason}")


# ─── Run Examples ────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  ACP Basic Usage Examples")
    print("=" * 60)

    # Example 1: Decorator
    print("\n--- Example 1: @requires_consent decorator ---\n")
    try:
        result = send_email(
            to="team@company.com",
            subject="Q3 Report",
            body="Please find attached the quarterly report.",
        )
        print(f"Result: {result}")
    except ConsentDeniedError as e:
        print(f"Action blocked: {e}")

    # Example 2: Client
    print("\n--- Example 2: ACPClient ---\n")
    example_with_client()

    # Example 3: Critical action
    print("\n--- Example 3: Critical action ---\n")
    try:
        transfer_money(to_account="IBAN-DE89370400440532013000", amount=10000)
    except ConsentDeniedError as e:
        print(f"Transfer blocked: {e}")
