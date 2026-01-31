"""
ACP Decorators — The simplest way to add consent to any function.

Usage:
    from acp import requires_consent

    @requires_consent("high")
    def send_email(to, body):
        ...

That's it. Two lines. Works with zero config (terminal prompt).
"""

from __future__ import annotations

import functools
import inspect
import os
from typing import Any, Callable, Optional, TypeVar, Union

F = TypeVar("F", bound=Callable[..., Any])

# Module-level default client (lazy-initialized)
_default_client = None


def _get_default_client():
    """Get or create the module-level default ACPClient."""
    global _default_client
    if _default_client is None:
        from .client import ACPClient

        _default_client = ACPClient(
            agent_id=os.environ.get("ACP_AGENT_ID", "default"),
            agent_name=os.environ.get("ACP_AGENT_NAME"),
        )
    return _default_client


def requires_consent(
    risk_level: Union[str, Callable] = "medium",
    category: Optional[str] = None,
    description: Optional[str] = None,
    estimated_impact: Optional[str] = None,
    auto_approve_low: bool = False,
) -> Callable:
    """
    Decorator that requires human consent before a function executes.

    Can be used with or without arguments:

        @requires_consent
        def my_func(): ...

        @requires_consent("high")
        def my_func(): ...

        @requires_consent(risk_level="critical", category="financial")
        def my_func(): ...

    Args:
        risk_level: Risk level — "low", "medium", "high", or "critical".
        category: Action category. Auto-detected from function name if not set.
        description: Human-readable description. Uses docstring if not set.
        estimated_impact: Description of potential impact.
        auto_approve_low: Auto-approve if risk is "low".
    """
    # Handle @requires_consent without parentheses
    if callable(risk_level):
        func = risk_level
        return _wrap_function(func, "medium", None, None, None, False)

    def decorator(func: F) -> F:
        return _wrap_function(
            func, risk_level, category, description, estimated_impact, auto_approve_low
        )

    return decorator


def _wrap_function(
    func: Callable,
    risk_level: str,
    category: Optional[str],
    description: Optional[str],
    estimated_impact: Optional[str],
    auto_approve_low: bool,
) -> Callable:
    """Wrap a function with consent checking."""

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        client = _get_default_client()

        # Build description from docstring if not provided
        desc = description
        if not desc:
            desc = func.__doc__
            if desc:
                desc = desc.strip().split("\n")[0]  # First line of docstring
            else:
                desc = f"Execute {func.__name__}"

        # Build parameters dict from function arguments
        sig = inspect.signature(func)
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        parameters = dict(bound.arguments)

        # Sanitize parameters (convert non-serializable to strings)
        safe_params = {}
        for k, v in parameters.items():
            try:
                import json
                json.dumps(v)
                safe_params[k] = v
            except (TypeError, ValueError):
                safe_params[k] = str(v)

        # Handle auto-approve for low risk
        if auto_approve_low and risk_level == "low":
            return func(*args, **kwargs)

        # Request consent
        response = client.request_consent(
            tool=func.__name__,
            description=desc,
            parameters=safe_params,
            risk_level=risk_level,
            category=category,
            estimated_impact=estimated_impact,
        )

        if response.approved:
            return func(*args, **kwargs)
        else:
            raise ConsentDeniedError(
                f"Consent denied for {func.__name__}: {response.reason or 'No reason given'}",
                response=response,
            )

    # Attach metadata
    wrapper._acp_risk_level = risk_level  # type: ignore
    wrapper._acp_category = category  # type: ignore
    wrapper._acp_consent_required = True  # type: ignore

    return wrapper  # type: ignore


class ConsentDeniedError(Exception):
    """Raised when human consent is denied for an action."""

    def __init__(self, message: str, response: Optional[Any] = None):
        super().__init__(message)
        self.response = response
