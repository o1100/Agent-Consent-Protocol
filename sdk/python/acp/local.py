"""
ACP Local Handler — Terminal-based consent prompts.

Zero dependencies. Uses rich formatting if available, falls back to plain text.
This is the default handler when no gateway or Telegram token is configured.
"""

from __future__ import annotations

import json
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .types import ConsentRequest, ConsentResponse

# Risk level display
RISK_DISPLAY = {
    "low": ("LOW", "🟢"),
    "medium": ("MEDIUM", "🟡"),
    "high": ("HIGH", "🔴"),
    "critical": ("CRITICAL", "⛔"),
}

CATEGORY_DISPLAY = {
    "communication": "💬",
    "financial": "💰",
    "data": "📊",
    "system": "⚙️",
    "public": "📢",
    "identity": "🪪",
    "physical": "🏠",
}


def _try_rich_prompt(request: "ConsentRequest") -> "ConsentResponse | None":
    """Try to use rich library for a prettier prompt. Returns None if rich isn't available."""
    try:
        from rich.console import Console
        from rich.panel import Panel
        from rich.table import Table
        from rich.prompt import Confirm
    except ImportError:
        return None

    from .types import ConsentResponse, ConsentDecision

    console = Console()

    risk = request.action.risk_level.value
    risk_label, risk_emoji = RISK_DISPLAY.get(risk, (risk.upper(), "❓"))
    cat_emoji = CATEGORY_DISPLAY.get(request.action.category.value, "❓")

    # Build info table
    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Key", style="bold cyan")
    table.add_column("Value")

    table.add_row("Agent", request.agent.name or request.agent.id)
    table.add_row("Action", f"[bold]{request.action.tool}[/bold]")
    table.add_row("Risk", f"{risk_emoji} [bold]{risk_label}[/bold]")
    table.add_row("Category", f"{cat_emoji} {request.action.category.value}")
    table.add_row("Description", request.action.description)

    if request.action.parameters:
        params_str = json.dumps(request.action.parameters, indent=2)
        table.add_row("Parameters", params_str)

    if request.action.estimated_impact:
        table.add_row("Impact", f"[yellow]{request.action.estimated_impact}[/yellow]")

    if request.context and request.context.conversation_summary:
        table.add_row("Context", request.context.conversation_summary)

    # Determine panel style based on risk
    style = {"low": "green", "medium": "yellow", "high": "red", "critical": "bold red"}
    panel_style = style.get(risk, "white")

    console.print()
    console.print(Panel(
        table,
        title="🤖 Agent Consent Request",
        subtitle=f"ID: {request.id}",
        border_style=panel_style,
    ))

    approved = Confirm.ask("\n  [bold]Approve this action?[/bold]", default=False)

    decision = ConsentDecision.APPROVED if approved else ConsentDecision.DENIED
    return ConsentResponse(
        request_id=request.id,
        decision=decision,
        approver_id="local_user",
        channel="terminal_rich",
    )


def _plain_prompt(request: "ConsentRequest") -> "ConsentResponse":
    """Plain-text terminal prompt. Zero dependencies."""
    from .types import ConsentResponse, ConsentDecision

    risk = request.action.risk_level.value
    risk_label, risk_emoji = RISK_DISPLAY.get(risk, (risk.upper(), "?"))
    cat_emoji = CATEGORY_DISPLAY.get(request.action.category.value, "?")

    print()
    print("=" * 60)
    print("  🤖 AGENT CONSENT REQUEST")
    print("=" * 60)
    print(f"  Agent:       {request.agent.name or request.agent.id}")
    print(f"  Action:      {request.action.tool}")
    print(f"  Risk:        {risk_emoji} {risk_label}")
    print(f"  Category:    {cat_emoji} {request.action.category.value}")
    print("-" * 60)
    print(f"  Description: {request.action.description}")
    print("-" * 60)

    if request.action.parameters:
        params_str = json.dumps(request.action.parameters, indent=2)
        indented = "\n".join(f"  {line}" for line in params_str.split("\n"))
        print("  Parameters:")
        print(indented)

    if request.action.estimated_impact:
        print(f"  Impact:      {request.action.estimated_impact}")

    if request.context and request.context.conversation_summary:
        print(f"  Context:     {request.context.conversation_summary}")

    print("=" * 60)

    while True:
        try:
            answer = input("\n  [A]pprove or [D]eny? ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n  → Denied (no input)")
            answer = "d"

        if answer in ("a", "approve", "y", "yes"):
            print("\n  → ✅ Approved\n")
            decision = ConsentDecision.APPROVED
            break
        elif answer in ("d", "deny", "n", "no"):
            print("\n  → ❌ Denied\n")
            decision = ConsentDecision.DENIED
            break
        else:
            print("  Please enter 'A' to approve or 'D' to deny.")

    return ConsentResponse(
        request_id=request.id,
        decision=decision,
        approver_id="local_user",
        channel="terminal",
    )


def prompt_local(request: "ConsentRequest") -> "ConsentResponse":
    """
    Prompt the user for consent in the terminal.

    Uses rich formatting if the `rich` library is available,
    otherwise falls back to plain text. Works in any terminal.
    """
    # Only try rich if stdout is a TTY
    if sys.stdout.isatty():
        result = _try_rich_prompt(request)
        if result is not None:
            return result

    return _plain_prompt(request)
