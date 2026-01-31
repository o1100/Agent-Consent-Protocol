"""
ACP + LangChain Integration Example

Shows how to wrap LangChain tools with ACP consent.
Requires: pip install acp-sdk[langchain] langchain-openai
"""

import asyncio
from acp import ACPClient, LangChainACPMiddleware

# Note: This example requires langchain-core to be installed
# pip install acp-sdk[langchain] langchain-openai


async def main():
    # Initialize ACP client
    client = ACPClient(
        gateway_url="http://localhost:3000",
        agent_id="langchain_agent",
        agent_name="LangChain Agent",
    )

    middleware = LangChainACPMiddleware(client)

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

        @tool
        def delete_file(path: str) -> str:
            """Delete a file from the filesystem."""
            return f"Deleted: {path}"

        # Wrap tools with ACP consent
        protected_email = middleware.wrap_tool(
            send_email, category="communication", risk_level="high"
        )
        protected_search = middleware.wrap_tool(
            search_web, category="data", risk_level="low"
        )
        protected_delete = middleware.wrap_tool(
            delete_file, category="data", risk_level="high"
        )

        # Use with LangGraph or ReAct agent:
        # from langchain_openai import ChatOpenAI
        # from langgraph.prebuilt import create_react_agent
        #
        # agent = create_react_agent(
        #     ChatOpenAI(model="gpt-4"),
        #     [protected_email, protected_search, protected_delete],
        # )

        print("✅ LangChain tools wrapped with ACP consent")
        print(f"   - {protected_email.name}: communication/high")
        print(f"   - {protected_search.name}: data/low")
        print(f"   - {protected_delete.name}: data/high")

    except ImportError:
        print("⚠️  LangChain not installed.")
        print("   Install with: pip install acp-sdk[langchain] langchain-core")

    await client.close()


if __name__ == "__main__":
    asyncio.run(main())
