"""
ACP — Direct Telegram Consent Handler (Tier 2)

Sends a consent request directly to Telegram and polls for a response.
No gateway needed — just set ACP_TELEGRAM_TOKEN and ACP_TELEGRAM_CHAT_ID.

Requires: pip install acp-sdk[remote]  (which adds `requests`)
"""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .types import ConsentRequest

from .types import ConsentDecision, ConsentResponse


RISK_EMOJI = {"low": "🟢", "medium": "🟡", "high": "🔴", "critical": "⛔"}
CATEGORY_EMOJI = {
    "communication": "💬", "financial": "💰", "data": "📊",
    "system": "⚙️", "public": "📢", "identity": "🪪", "physical": "🏠",
}


def prompt_telegram(
    request: "ConsentRequest",
    bot_token: Optional[str] = None,
    chat_id: Optional[str] = None,
    timeout_seconds: int = 900,
) -> ConsentResponse:
    """
    Send a consent request to Telegram and wait for button callback.

    Uses only the `requests` library — no bot framework needed.
    """
    try:
        import requests as http
    except ImportError:
        raise ImportError(
            "Telegram mode requires the 'requests' library. "
            "Install with: pip install acp-sdk[remote]"
        )

    if not bot_token or not chat_id:
        raise ValueError(
            "Telegram mode requires ACP_TELEGRAM_TOKEN and ACP_TELEGRAM_CHAT_ID "
            "environment variables (or pass bot_token/chat_id)."
        )

    api = f"https://api.telegram.org/bot{bot_token}"
    action = request.action
    risk = action.risk_level.value
    category = action.category.value

    # Format parameters (truncate for Telegram message limits)
    params_str = json.dumps(action.parameters, indent=2, default=str)
    if len(params_str) > 500:
        params_str = params_str[:497] + "..."

    text = (
        f"🤖 *Agent Consent Request*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"*Action:* `{action.tool}`\n"
        f"*Risk:* {RISK_EMOJI.get(risk, '❓')} {risk.upper()}\n"
        f"*Category:* {CATEGORY_EMOJI.get(category, '❓')} {category}\n"
    )

    if request.agent.name:
        text += f"*Agent:* {request.agent.name}\n"

    if action.description:
        text += f"\n📝 {_escape_md(action.description)}\n"

    text += f"\n```json\n{params_str}\n```"

    if request.context and request.context.conversation_summary:
        text += f"\n💡 _{_escape_md(request.context.conversation_summary)}_"

    # Send message with inline buttons
    keyboard = {
        "inline_keyboard": [[
            {"text": "✅ Approve", "callback_data": f"acp:approve:{request.id}"},
            {"text": "❌ Deny", "callback_data": f"acp:deny:{request.id}"},
        ]]
    }

    resp = http.post(f"{api}/sendMessage", json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
        "reply_markup": keyboard,
    }, timeout=30)
    resp.raise_for_status()
    msg_data = resp.json()
    message_id = msg_data["result"]["message_id"]

    # Get current update_id to only look at new updates
    updates_resp = http.get(f"{api}/getUpdates", params={"limit": 1, "offset": -1}, timeout=10)
    last_update_id = 0
    if updates_resp.ok:
        results = updates_resp.json().get("result", [])
        if results:
            last_update_id = results[-1]["update_id"] + 1

    # Poll for callback
    start = time.time()
    while time.time() - start < timeout_seconds:
        try:
            updates = http.get(f"{api}/getUpdates", params={
                "offset": last_update_id,
                "timeout": 10,  # Long polling
                "allowed_updates": '["callback_query"]',
            }, timeout=15)

            if not updates.ok:
                time.sleep(2)
                continue

            for update in updates.json().get("result", []):
                last_update_id = update["update_id"] + 1
                callback = update.get("callback_query")
                if not callback or not callback.get("data", "").startswith("acp:"):
                    continue

                parts = callback["data"].split(":")
                if len(parts) != 3 or parts[2] != request.id:
                    continue

                decision_str = parts[1]
                user = callback.get("from", {})
                user_name = user.get("first_name", "User")

                # Answer the callback
                http.post(f"{api}/answerCallbackQuery", json={
                    "callback_query_id": callback["id"],
                    "text": "✅ Approved!" if decision_str == "approve" else "❌ Denied",
                }, timeout=10)

                # Update the message
                decision = (
                    ConsentDecision.APPROVED
                    if decision_str == "approve"
                    else ConsentDecision.DENIED
                )
                emoji = "✅" if decision == ConsentDecision.APPROVED else "❌"
                label = "Approved" if decision == ConsentDecision.APPROVED else "Denied"

                http.post(f"{api}/editMessageText", json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": (
                        f"{emoji} *{label}* by {user_name}\n"
                        f"Action: `{action.tool}`\n"
                        f"ID: `{request.id}`"
                    ),
                    "parse_mode": "Markdown",
                }, timeout=10)

                return ConsentResponse(
                    request_id=request.id,
                    decision=decision,
                    approver_id=f"tg_{user.get('id', 'unknown')}",
                    channel="telegram",
                    reason=f"{label} by {user_name} via Telegram",
                )

        except http.exceptions.Timeout:
            continue
        except Exception:
            time.sleep(2)

    # Timeout — update message and deny
    try:
        http.post(f"{api}/editMessageText", json={
            "chat_id": chat_id,
            "message_id": message_id,
            "text": f"⏰ *Expired* — `{action.tool}` timed out (auto\\-denied)",
            "parse_mode": "MarkdownV2",
        }, timeout=10)
    except Exception:
        pass

    return ConsentResponse(
        request_id=request.id,
        decision=ConsentDecision.DENIED,
        approver_id="system_timeout",
        channel="telegram",
        reason=f"Timed out after {timeout_seconds}s",
    )


def _escape_md(text: str) -> str:
    """Escape Markdown special characters for Telegram."""
    for char in ("_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!"):
        text = text.replace(char, f"\\{char}")
    return text
