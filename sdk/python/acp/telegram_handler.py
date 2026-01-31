"""
ACP Telegram Handler — Direct Telegram approval without a gateway.

Tier 2: Set ACP_TELEGRAM_TOKEN and ACP_TELEGRAM_CHAT_ID env vars,
and you get mobile approvals with zero server infrastructure.

Uses only stdlib + requests (optional dependency).
"""

from __future__ import annotations

import json
import os
import time
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .types import ConsentRequest, ConsentResponse

# Risk emoji mapping
RISK_EMOJI = {"low": "🟢", "medium": "🟡", "high": "🔴", "critical": "⛔"}
CATEGORY_EMOJI = {
    "communication": "💬",
    "financial": "💰",
    "data": "📊",
    "system": "⚙️",
    "public": "📢",
    "identity": "🪪",
    "physical": "🏠",
}


def _get_requests():
    """Import requests, raising a clear error if not installed."""
    try:
        import requests
        return requests
    except ImportError:
        raise ImportError(
            "The 'requests' library is required for Telegram mode. "
            "Install it with: pip install acp-sdk[remote]  or  pip install requests"
        )


def _format_message(request: "ConsentRequest") -> str:
    """Format a consent request as a Telegram message."""
    risk = request.action.risk_level.value
    category = request.action.category.value
    risk_emoji = RISK_EMOJI.get(risk, "❓")
    cat_emoji = CATEGORY_EMOJI.get(category, "❓")

    params_str = json.dumps(request.action.parameters, indent=2)
    if len(params_str) > 500:
        params_str = params_str[:497] + "..."

    lines = [
        "🤖 *Agent Consent Request*",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        f"*Agent:* {request.agent.name or request.agent.id}",
        f"*Action:* `{request.action.tool}`",
        f"*Risk:* {risk_emoji} {risk.upper()}",
        f"*Category:* {cat_emoji} {category}",
        "",
        "📝 *Description:*",
        request.action.description,
        "",
        "📋 *Parameters:*",
        f"```json\n{params_str}\n```",
    ]

    if request.context and request.context.conversation_summary:
        lines.extend(["", "💡 *Context:*", request.context.conversation_summary])

    lines.extend(["", f"📎 ID: `{request.id}`"])

    return "\n".join(lines)


def prompt_telegram(
    request: "ConsentRequest",
    bot_token: Optional[str] = None,
    chat_id: Optional[str] = None,
    timeout_seconds: int = 900,
    poll_interval: float = 2.0,
) -> "ConsentResponse":
    """
    Send a consent request to Telegram and wait for approval via inline buttons.

    Args:
        request: The consent request to send.
        bot_token: Telegram bot token. Defaults to ACP_TELEGRAM_TOKEN env var.
        chat_id: Telegram chat ID. Defaults to ACP_TELEGRAM_CHAT_ID env var.
        timeout_seconds: How long to wait for a response (default: 15 min).
        poll_interval: How often to poll for updates (default: 2s).

    Returns:
        ConsentResponse with the human's decision.
    """
    from .types import ConsentResponse, ConsentDecision

    requests = _get_requests()

    token = bot_token or os.environ.get("ACP_TELEGRAM_TOKEN")
    chat = chat_id or os.environ.get("ACP_TELEGRAM_CHAT_ID")

    if not token:
        raise ValueError(
            "Telegram bot token required. Set ACP_TELEGRAM_TOKEN env var "
            "or pass bot_token parameter."
        )
    if not chat:
        raise ValueError(
            "Telegram chat ID required. Set ACP_TELEGRAM_CHAT_ID env var "
            "or pass chat_id parameter."
        )

    base_url = f"https://api.telegram.org/bot{token}"

    # Send the message with inline keyboard
    text = _format_message(request)
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Approve", "callback_data": f"acp:approve:{request.id}"},
                {"text": "❌ Deny", "callback_data": f"acp:deny:{request.id}"},
            ]
        ]
    }

    resp = requests.post(
        f"{base_url}/sendMessage",
        json={
            "chat_id": chat,
            "text": text,
            "parse_mode": "Markdown",
            "reply_markup": keyboard,
        },
        timeout=30,
    )
    resp.raise_for_status()
    msg_data = resp.json()
    message_id = msg_data["result"]["message_id"]

    # Poll for callback query responses
    start_time = time.time()
    last_update_id = 0

    while time.time() - start_time < timeout_seconds:
        try:
            resp = requests.get(
                f"{base_url}/getUpdates",
                params={
                    "offset": last_update_id + 1,
                    "timeout": int(poll_interval),
                    "allowed_updates": json.dumps(["callback_query"]),
                },
                timeout=poll_interval + 10,
            )
            resp.raise_for_status()
            updates = resp.json().get("result", [])

            for update in updates:
                last_update_id = update["update_id"]
                callback = update.get("callback_query")

                if not callback or not callback.get("data", "").startswith("acp:"):
                    continue

                parts = callback["data"].split(":")
                if len(parts) != 3 or parts[2] != request.id:
                    continue

                action = parts[1]
                decision = (
                    ConsentDecision.APPROVED
                    if action == "approve"
                    else ConsentDecision.DENIED
                )
                approver_id = f"tg_{callback['from']['id']}"
                approver_name = callback["from"].get("first_name", "User")

                # Answer the callback query
                requests.post(
                    f"{base_url}/answerCallbackQuery",
                    json={
                        "callback_query_id": callback["id"],
                        "text": "Approved!" if action == "approve" else "Denied!",
                    },
                    timeout=10,
                )

                # Update the message
                emoji = "✅" if action == "approve" else "❌"
                label = "Approved" if action == "approve" else "Denied"
                requests.post(
                    f"{base_url}/editMessageText",
                    json={
                        "chat_id": chat,
                        "message_id": message_id,
                        "text": (
                            f"{emoji} *{label}* by {approver_name}\n"
                            f"Request: `{request.id}`\n"
                            f"Action: `{request.action.tool}`"
                        ),
                        "parse_mode": "Markdown",
                    },
                    timeout=10,
                )

                return ConsentResponse(
                    request_id=request.id,
                    decision=decision,
                    approver_id=approver_id,
                    channel="telegram",
                )

        except Exception:
            # Network errors — keep polling
            time.sleep(poll_interval)
            continue

    # Timeout — update message and deny
    try:
        requests.post(
            f"{base_url}/editMessageText",
            json={
                "chat_id": chat,
                "message_id": message_id,
                "text": f"⏰ *Expired* — Request `{request.id}` timed out.",
                "parse_mode": "Markdown",
            },
            timeout=10,
        )
    except Exception:
        pass

    return ConsentResponse(
        request_id=request.id,
        decision=ConsentDecision.DENIED,
        approver_id="system_timeout",
        channel="telegram",
        reason="Request timed out",
    )
