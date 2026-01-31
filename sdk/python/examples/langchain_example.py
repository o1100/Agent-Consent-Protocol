"""
ACP + LangChain Integration Example.

Shows how to wrap LangChain tools with ACP consent gates.
"""

from acp import ACPClient, ConsentDeniedError

# Initialize ACP client
acp = ACPClient(agent_id="langchain-agent", agent_name="LangChain Assistant")


def acp_tool_wrapper(tool_func, risk_level="medium", category=None):
    """Wrap a LangChain tool function with ACP consent."""

    def wrapped(*args, **kwargs):
        # Extract tool info
        tool_name = getattr(tool_func, "name", tool_func.__name__)
        tool_desc = getattr(tool_func, "description", tool_func.__doc__ or tool_name)

        response = acp.request_consent(
            tool=tool_name,
            description=tool_desc,
            parameters=kwargs or ({"input": args[0]} if args else {}),
            risk_level=risk_level,
            category=category,
        )

        if response.approved:
            return tool_func(*args, **kwargs)
        else:
            return f"Action denied by human reviewer: {response.reason or 'No reason given'}"

    wrapped.__name__ = getattr(tool_func, "name", tool_func.__name__)
    wrapped.__doc__ = getattr(tool_func, "description", tool_func.__doc__)
    return wrapped


# ─── Example with LangChain (if installed) ───────────────────────────

def example_langchain():
    """Full LangChain example with ACP consent."""
    try:
        from langchain_core.tools import tool
    except ImportError:
        print("LangChain not installed. Showing mock example.\n")
        return mock_example()

    @tool
    def send_email(to: str, subject: str, body: str) -> str:
        """Send an email to the specified recipient."""
        return f"Email sent to {to}: {subject}"

    @tool
    def search_web(query: str) -> str:
        """Search the web for information."""
        return f"Search results for: {query}"

    # Wrap tools with ACP
    safe_email = acp_tool_wrapper(send_email, risk_level="high", category="communication")
    safe_search = acp_tool_wrapper(search_web, risk_level="low", category="data")

    # Low risk: might auto-approve
    print("Searching web (low risk)...")
    result = safe_search(query="ACP protocol specification")
    print(f"Result: {result}\n")

    # High risk: requires consent
    print("Sending email (high risk)...")
    result = safe_email(to="ceo@company.com", subject="Report", body="See attached")
    print(f"Result: {result}\n")


def mock_example():
    """Mock example without LangChain dependency."""

    def send_email(to, subject, body):
        return f"Email sent to {to}: {subject}"

    safe_email = acp_tool_wrapper(send_email, risk_level="high", category="communication")

    print("Attempting to send email (high risk action)...")
    try:
        result = safe_email(to="ceo@company.com", subject="Urgent", body="...")
        print(f"Result: {result}")
    except ConsentDeniedError as e:
        print(f"Blocked: {e}")


if __name__ == "__main__":
    print("ACP + LangChain Example\n")
    example_langchain()
