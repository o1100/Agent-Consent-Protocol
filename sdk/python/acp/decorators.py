"""
ACP — The @requires_consent decorator.

The simplest possible API:

    from acp import requires_consent

    @requires_consent("high")
    def send_email(to, body):
        ...

Works with zero config. No gateway, no server, no database.
Just a terminal prompt asking the human to approve.
"""

from __future__ import annotations

import functools
import inspect
import json
import os
import sys
from typing import Any, Callable, Optional, TypeVar, Union

F = TypeVar("F", bound=Callable[..., Any])

# Module-level default client, created lazily
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


class ConsentDeniedError(Exception):
    """Raised when a human denies consent for an action."""

    def __init__(self, message: str, response: Optional[Any] = None):
        super().__init__(message)
        self.response = response


def requires_consent(
    risk_level: Union[str, Callable] = "medium",
    category: Optional[str] = None,
    description: Optional[str] = None,
    estimated_impact: Optional[str] = None,
) -> Callable:
    """
    Decorator that requires human consent before a function executes.

    Usage — all of these work:

        @requires_consent              # defaults to medium risk
        def my_func(): ...

        @requires_consent("high")      # just risk level
        def my_func(): ...

        @requires_consent("critical", category="financial")
        def my_func(): ...

    How it works:
      - Tier 1 (default): Shows a terminal prompt. Zero deps, zero config.
      - Tier 2: If ACP_TELEGRAM_TOKEN is set, sends to Telegram instead.
      - Tier 3: If ACP_GATEWAY_URL is set, uses the full gateway.

    Risk levels: "low", "medium", "high", "critical"
    Categories: auto-detected from function name, or specify explicitly.

    Raises ConsentDeniedError if the human says no.
    """
    # Handle @requires_consent without parentheses
    if callable(risk_level):
        func = risk_level
        return _wrap_function(func, "medium", None, None, None)

    def decorator(func: F) -> F:
        return _wrap_function(func, str(risk_level), category, description, estimated_impact)

    return decorator


def _wrap_function(
    func: Callable,
    risk_level: str,
    category: Optional[str],
    description: Optional[str],
    estimated_impact: Optional[str],
) -> Callable:
    """Wrap a function with consent checking. Supports sync and async."""
    is_async = inspect.iscoroutinefunction(func)

    @functools.wraps(func)
    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        _check_consent(func, args, kwargs, risk_level, category, description, estimated_impact)
        return func(*args, **kwargs)

    @functools.wraps(func)
    async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
        _check_consent(func, args, kwargs, risk_level, category, description, estimated_impact)
        return await func(*args, **kwargs)

    wrapper = async_wrapper if is_async else sync_wrapper

    # Attach metadata for introspection
    wrapper._acp_risk_level = risk_level  # type: ignore[attr-defined]
    wrapper._acp_category = category  # type: ignore[attr-defined]
    wrapper._acp_consent_required = True  # type: ignore[attr-defined]

    return wrapper  # type: ignore[return-value]


def _check_consent(
    func: Callable,
    args: tuple,
    kwargs: dict,
    risk_level: str,
    category: Optional[str],
    description: Optional[str],
    estimated_impact: Optional[str],
) -> None:
    """Run the consent check. Raises ConsentDeniedError on denial."""
    client = _get_default_client()

    # Build description from docstring if not provided
    desc = description
    if not desc:
        if func.__doc__:
            desc = func.__doc__.strip().split("\n")[0]
        else:
            desc = f"Execute {func.__name__}"

    # Build parameters from function arguments
    sig = inspect.signature(func)
    try:
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        parameters = dict(bound.arguments)
    except TypeError:
        parameters = {"args": list(args), "kwargs": kwargs}

    # Sanitize parameters for display (convert non-JSON-serializable to str)
    safe_params = {}
    for k, v in parameters.items():
        try:
            json.dumps(v)
            safe_params[k] = v
        except (TypeError, ValueError):
            safe_params[k] = repr(v)

    response = client.request_consent(
        tool=func.__name__,
        parameters=safe_params,
        description=desc,
        risk_level=risk_level,
        category=category,
        estimated_impact=estimated_impact,
    )

    if not response.approved:
        raise ConsentDeniedError(
            f"Consent denied for {func.__name__}: {response.reason or 'No reason given'}",
            response=response,
        )
