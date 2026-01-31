"""
ACP — Basic Usage

The simplest possible integration. No server, no config, no dependencies.
Just a decorator and a terminal prompt.
"""

from acp import requires_consent, ConsentDeniedError


# ─── That's it. This function now requires human approval. ────────

@requires_consent("high")
def send_email(to: str, subject: str, body: str) -> dict:
    """Send an email to the specified recipient."""
    print(f"📧 Sending email to {to}: {subject}")
    return {"status": "sent", "to": to}


@requires_consent("critical", category="financial")
def transfer_money(amount: float, to_account: str) -> dict:
    """Transfer funds to another account."""
    print(f"💰 Transferring ${amount} to {to_account}")
    return {"status": "completed", "amount": amount}


@requires_consent  # defaults to "medium" risk
def write_report(title: str, content: str) -> dict:
    """Write a report to disk."""
    print(f"📝 Writing report: {title}")
    return {"status": "written", "title": title}


# ─── Usage ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("ACP Basic Usage — Terminal Consent\n")

    try:
        result = send_email("boss@company.com", "Weekly Report", "All good.")
        print(f"Result: {result}\n")
    except ConsentDeniedError:
        print("Email was denied by the human.\n")

    try:
        result = transfer_money(500.00, "ACCT-12345")
        print(f"Result: {result}\n")
    except ConsentDeniedError:
        print("Transfer was denied by the human.\n")
