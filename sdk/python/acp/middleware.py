"""
ACP — Framework Middleware (LangChain, generic wrappers)

Optional integration layer. Requires the respective frameworks to be installed.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from .client import ACPClient
from .decorators import ConsentDeniedError


class ACPToolWrapper:
    """
    Generic tool wrapper that adds ACP consent to any callable.

    Usage:
        from acp import ACPClient
        from acp.middleware import ACPToolWrapper

        client = ACPClient()
        wrapper = ACPToolWrapper(client)

        protected = wrapper.wrap(send_email, category="communication", risk_level="high")
        result = protected(to="user@example.com", subject="Hi")
    """

    def __init__(self, client: Optional[ACPClient] = None):
        self.client = client or ACPClient()

    def wrap(
        self,
        func: Callable[..., Any],
        tool_name: Optional[str] = None,
        category: Optional[str] = None,
        risk_level: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Callable[..., Any]:
        """Wrap a function with ACP consent checks."""
        import functools

        name = tool_name or func.__name__
        desc = description or func.__doc__ or f"Execute {name}"
        client = self.client

        @functools.wraps(func)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            response = client.request_consent(
                tool=name,
                parameters=kwargs or {"args": list(args)},
                description=desc,
                category=category,
                risk_level=risk_level,
            )

            if not response.approved:
                raise ConsentDeniedError(
                    f"Consent denied for {name}: {response.reason}",
                    response=response,
                )

            return func(*args, **kwargs)

        return wrapped


class LangChainACPMiddleware:
    """
    Middleware for wrapping LangChain tools with ACP consent.

    Usage:
        from acp.middleware import LangChainACPMiddleware

        middleware = LangChainACPMiddleware()  # Uses default client

        @tool
        def send_email(to: str, subject: str, body: str) -> str:
            return email_service.send(to, subject, body)

        protected_tool = middleware.wrap_tool(send_email, category="communication", risk_level="high")
    """

    def __init__(self, client: Optional[ACPClient] = None):
        self.client = client or ACPClient()

    def wrap_tool(
        self,
        tool: Any,
        category: Optional[str] = None,
        risk_level: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Any:
        """Wrap a LangChain BaseTool with ACP consent."""
        try:
            from langchain_core.tools import ToolException
        except ImportError:
            raise ImportError(
                "LangChain integration requires langchain-core. "
                "Install with: pip install langchain-core"
            )

        client = self.client
        tool_name = tool.name
        tool_description = description or tool.description
        original_run = tool._run

        def consent_run(*args: Any, **kwargs: Any) -> Any:
            response = client.request_consent(
                tool=tool_name,
                parameters=kwargs or ({"input": args[0]} if args else {}),
                description=tool_description,
                category=category,
                risk_level=risk_level,
            )

            if not response.approved:
                raise ToolException(
                    f"Action denied: {response.reason or 'No reason given'}"
                )

            return original_run(*args, **kwargs)

        tool._run = consent_run
        return tool
