"""
ACP — Local Terminal Consent Handler (Tier 1)

Zero dependencies. Pure Python stdlib. Works out of the box.
Shows a formatted prompt in the terminal and reads y/n from stdin.
"""

from __future__ import annotations

import json
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .types import ConsentRequest

from .types import ConsentDecision, ConsentResponse

# ─── ANSI colors (fallback-safe) ─────────────────────────────────

def _supports_color() -> bool:
    """Check if the terminal supports ANSI colors."""
    if not hasattr(sys.stdout, "isatty") or not sys.stdout.isatty():
        return False
    return True


_COLOR = _supports_color()

def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else text

def _bold(t: str) -> str: return _c("1", t)
def _red(t: str) -> str: return _c("91", t)
def _yellow(t: str) -> str: return _c("93", t)
def _green(t: str) -> str: return _c("92", t)
def _cyan(t: str) -> str: return _c("96", t)
def _dim(t: str) -> str: return _c("2", t)


RISK_STYLE = {
    "low": ("🟢", _green),
    "medium": ("🟡", _yellow),
    "high": ("🔴", _red),
    "critical": ("⛔", _red),
}

CATEGORY_EMOJI = {
    "communication": "💬",
    "financial": "💰",
    "data": "📊",
    "system": "⚙️",
    "public": "📢",
    "identity": "🪪",
    "physical": "🏠",
}


def prompt_local(request: "ConsentRequest") -> ConsentResponse:
    """
    Display a consent request in the terminal and prompt for approval.

    This is the Tier 1 handler — works with zero dependencies,
    zero configuration. Just a decorated function and a terminal.
    """
    action = request.action
    risk = action.risk_level.value
    category = action.category.value

    emoji, style_fn = RISK_STYLE.get(risk, ("❓", lambda t: t))
    cat_emoji = CATEGORY_EMOJI.get(category, "❓")

    # Format parameters nicely
    params_str = json.dumps(action.parameters, indent=2, default=str)
    if len(params_str) > 800:
        params_str = params_str[:797] + "..."

    # Build the prompt
    lines = [
        "",
        _bold("═" * 56),
        _bold("  🤖 AGENT CONSENT REQUEST"),
        _bold("═" * 56),
        f"  {_bold('Action:')}   {_cyan(action.tool)}",
        f"  {_bold('Risk:')}     {emoji} {style_fn(risk.upper())}",
        f"  {_bold('Category:')} {cat_emoji} {category}",
    ]

    if request.agent.name:
        lines.append(f"  {_bold('Agent:')}    {request.agent.name}")

    lines.append("─" * 56)

    if action.description:
        lines.append(f"  {action.description}")
        lines.append("─" * 56)

    lines.append(_dim("  Parameters:"))
    for param_line in params_str.split("\n"):
        lines.append(f"    {param_line}")

    if action.estimated_impact:
        lines.append("─" * 56)
        lines.append(f"  {_bold('Impact:')} {action.estimated_impact}")

    if request.context and request.context.conversation_summary:
        lines.append("─" * 56)
        lines.append(f"  {_bold('Context:')} {request.context.conversation_summary}")

    lines.append(_bold("═" * 56))

    # Print it
    print("\n".join(lines), file=sys.stderr)

    # Prompt
    try:
        answer = input(f"\n  {_bold('Approve?')} [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print(file=sys.stderr)
        answer = ""

    if answer in ("y", "yes"):
        print(f"\n  {_green('✅ Approved')}\n", file=sys.stderr)
        return ConsentResponse(
            request_id=request.id,
            decision=ConsentDecision.APPROVED,
            approver_id="local_user",
            channel="terminal",
            reason="Approved via terminal",
        )
    else:
        reason = ""
        if answer not in ("n", "no", ""):
            reason = answer  # Treat non-y/n input as a denial reason
        print(f"\n  {_red('❌ Denied')}\n", file=sys.stderr)
        return ConsentResponse(
            request_id=request.id,
            decision=ConsentDecision.DENIED,
            approver_id="local_user",
            channel="terminal",
            reason=reason or "Denied via terminal",
        )
