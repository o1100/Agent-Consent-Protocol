"""
ACP Python SDK — Framework Middleware

Middleware integrations for LangChain and generic tool wrappers.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Type

from .client import ACPClient
from .types import ConsentBlocked, ConsentDenied, ConsentTimeout


class ACPToolWrapper:
    """
    Generic tool wrapper that adds ACP consent to any callable.

    Usage:
        client = ACPClient(gateway_url="http://localhost:3000", agent_id="my_agent")
        wrapper = ACPToolWrapper(client)

        protected_send = wrapper.wrap(
            send_email,
            tool_name="send_email",
            category="communication",
            risk_level="high",
        )

        result = await protected_send(to="user@example.com", subject="Hi")
    """

    def __init__(self, client: ACPClient):
        self.client = client

    def wrap(
        self,
        func: Callable[..., Any],
        tool_name: Optional[str] = None,
        category: str = "data",
        risk_level: str = "medium",
        description: Optional[str] = None,
    ) -> Callable[..., Any]:
        """Wrap a function with ACP consent checks."""
        name = tool_name or func.__name__
        desc = description or func.__doc__ or f"Execute {name}"

        async def wrapped(**kwargs: Any) -> Any:
            consent = await self.client.request_consent(
                tool=name,
                parameters=kwargs,
                description=desc,
                category=category,
                risk_level=risk_level,
            )

            response = await consent.wait_for_decision()

            if response.modifications:
                kwargs = response.apply_modifications(kwargs)

            if hasattr(func, "__await__") or hasattr(func, "__aenter__"):
                return await func(**kwargs)
            return func(**kwargs)

        wrapped.__name__ = name  # type: ignore
        wrapped.__doc__ = desc
        return wrapped


class LangChainACPMiddleware:
    """
    Middleware for wrapping LangChain tools with ACP consent.

    Usage:
        from langchain_core.tools import tool
        from acp.middleware import LangChainACPMiddleware

        client = ACPClient(gateway_url="http://localhost:3000", agent_id="agent")
        middleware = LangChainACPMiddleware(client)

        @tool
        def send_email(to: str, subject: str, body: str) -> str:
            '''Send an email.'''
            return email_service.send(to, subject, body)

        protected_tool = middleware.wrap_tool(
            send_email,
            category="communication",
            risk_level="high",
        )
    """

    def __init__(self, client: ACPClient):
        self.client = client

    def wrap_tool(
        self,
        tool: Any,
        category: str = "data",
        risk_level: str = "medium",
        description: Optional[str] = None,
    ) -> Any:
        """
        Wrap a LangChain BaseTool with ACP consent.

        Returns a new tool that checks consent before execution.
        """
        try:
            from langchain_core.tools import BaseTool, ToolException
        except ImportError:
            raise ImportError(
                "LangChain integration requires langchain-core. "
                "Install with: pip install acp-sdk[langchain]"
            )

        client = self.client
        tool_name = tool.name
        tool_description = description or tool.description

        original_run = tool._run
        original_arun = getattr(tool, "_arun", None)

        async def consent_arun(*args: Any, **kwargs: Any) -> Any:
            try:
                consent = await client.request_consent(
                    tool=tool_name,
                    parameters=kwargs or ({"input": args[0]} if args else {}),
                    description=tool_description,
                    category=category,
                    risk_level=risk_level,
                )

                response = await consent.wait_for_decision()

                if response.modifications:
                    kwargs = response.apply_modifications(kwargs)

                if original_arun:
                    return await original_arun(*args, **kwargs)
                return original_run(*args, **kwargs)

            except ConsentDenied as e:
                raise ToolException(f"Action denied by human approver: {e.reason}")
            except ConsentTimeout:
                raise ToolException("Consent request timed out — action blocked")
            except ConsentBlocked as e:
                raise ToolException(f"Action blocked by policy: {e.reason}")

        tool._arun = consent_arun

        # Also wrap sync _run to go through consent
        import asyncio

        def consent_run(*args: Any, **kwargs: Any) -> Any:
            return asyncio.run(consent_arun(*args, **kwargs))

        tool._run = consent_run

        return tool
