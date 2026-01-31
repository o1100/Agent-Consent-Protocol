"""
ACP + LangChain Integration

Wrap LangChain tools with ACP consent. Works at any tier:
- Default: terminal prompt
- ACP_TELEGRAM_TOKEN set: mobile approval
- ACP_GATEWAY_URL set: full gateway

Requires: pip install langchain-core
"""

from acp.middleware import LangChainACPMiddleware

middleware = LangChainACPMiddleware()  # Uses default client (auto-detects mode)

try:
    from langchain_core.tools import tool

    @tool
    def send_email(to: str, subject: str, body: str) -> str:
        """Send an email to the specified recipient."""
        return f"Email sent to {to}: {subject}"

    @tool
    def search_web(query: str) -> str:
        """Search the web for information."""
        return f"Search results for: {query}"

    # Wrap with consent — category/risk auto-detected from tool name!
    protected_email = middleware.wrap_tool(send_email)    # → communication/high
    protected_search = middleware.wrap_tool(search_web)   # → data/low

    # Or override:
    # protected_email = middleware.wrap_tool(send_email, category="communication", risk_level="critical")

    print("✅ LangChain tools wrapped with ACP consent")

    # Use with LangGraph:
    # from langgraph.prebuilt import create_react_agent
    # agent = create_react_agent(llm, [protected_email, protected_search])

except ImportError:
    print("Install langchain-core to run this example:")
    print("  pip install langchain-core")
