"""
ACP Client — Core consent client with automatic mode detection.

Three modes, auto-detected from environment:

  1. Local (default): Terminal prompt. Zero dependencies.
  2. Telegram: Set ACP_TELEGRAM_TOKEN + ACP_TELEGRAM_CHAT_ID. Needs `requests`.
  3. Gateway: Set ACP_GATEWAY_URL. Needs `requests`.

Usage:
    from acp import ACPClient

    client = ACPClient()  # That's it. Mode auto-detected.
    response = client.request_consent("send_email", {"to": "ceo@co.com"}, "Send report")
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable, Dict, Optional

from .types import (
    ActionCategory,
    ActionInfo,
    AgentInfo,
    ConsentDecision,
    ConsentRequest,
    ConsentResponse,
    RequestContext,
    RiskLevel,
    classify_tool,
)


class ACPClient:
    """
    Agent Consent Protocol client.

    Automatically selects the best consent handler based on environment:
      - ACP_GATEWAY_URL set → full gateway mode (Tier 3)
      - ACP_TELEGRAM_TOKEN set → direct Telegram mode (Tier 2)
      - Neither → local terminal prompt (Tier 1)
    """

    def __init__(
        self,
        agent_id: str = "default",
        agent_name: Optional[str] = None,
        framework: Optional[str] = None,
        gateway_url: Optional[str] = None,
        gateway_api_key: Optional[str] = None,
        telegram_token: Optional[str] = None,
        telegram_chat_id: Optional[str] = None,
        mode: Optional[str] = None,
        on_consent: Optional[Callable[["ConsentRequest"], "ConsentResponse"]] = None,
        auto_approve_low_risk: bool = False,
        timeout_seconds: int = 900,
    ):
        self.agent = AgentInfo(
            id=agent_id,
            name=agent_name,
            framework=framework,
        )
        self.gateway_url = gateway_url or os.environ.get("ACP_GATEWAY_URL")
        self.gateway_api_key = gateway_api_key or os.environ.get("ACP_GATEWAY_API_KEY")
        self.telegram_token = telegram_token or os.environ.get("ACP_TELEGRAM_TOKEN")
        self.telegram_chat_id = telegram_chat_id or os.environ.get("ACP_TELEGRAM_CHAT_ID")
        self.on_consent = on_consent
        self.auto_approve_low_risk = auto_approve_low_risk
        self.timeout_seconds = timeout_seconds

        # Auto-detect mode
        if mode:
            self._mode = mode
        elif self.gateway_url:
            self._mode = "gateway"
        elif self.telegram_token:
            self._mode = "telegram"
        else:
            self._mode = "local"

    @property
    def mode(self) -> str:
        return self._mode

    def request_consent(
        self,
        tool: str,
        parameters: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None,
        category: Optional[str] = None,
        risk_level: Optional[str] = None,
        estimated_impact: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ) -> ConsentResponse:
        """
        Request human consent for an action.

        Returns ConsentResponse. Check response.approved to see if the human said yes.
        """
        # Auto-classify if not provided
        auto_cat, auto_risk = classify_tool(tool, category, risk_level)

        action = ActionInfo(
            tool=tool,
            category=auto_cat,
            risk_level=auto_risk,
            parameters=parameters or {},
            description=description or f"Execute {tool}",
            estimated_impact=estimated_impact,
        )

        req_context = None
        if context:
            req_context = RequestContext(
                conversation_summary=context.get("conversation_summary"),
                previous_actions=context.get("previous_actions"),
                trigger=context.get("trigger"),
            )

        agent = AgentInfo(
            id=self.agent.id,
            name=self.agent.name,
            framework=self.agent.framework,
            session_id=session_id,
        )

        request = ConsentRequest(action=action, agent=agent, context=req_context)

        # Auto-approve low risk if configured
        if self.auto_approve_low_risk and auto_risk == RiskLevel.LOW:
            return ConsentResponse(
                request_id=request.id,
                decision=ConsentDecision.APPROVED,
                approver_id="policy_auto",
                channel="auto",
                reason="Auto-approved: low risk",
                auto_approved=True,
            )

        # Custom handler
        if self.on_consent:
            return self.on_consent(request)

        # Route to handler
        if self._mode == "gateway":
            return self._request_gateway(request)
        elif self._mode == "telegram":
            return self._request_telegram(request)
        else:
            return self._request_local(request)

    def _request_local(self, request: ConsentRequest) -> ConsentResponse:
        """Tier 1: Terminal prompt. Zero deps."""
        from .local import prompt_local
        return prompt_local(request)

    def _request_telegram(self, request: ConsentRequest) -> ConsentResponse:
        """Tier 2: Direct Telegram. Needs `requests`."""
        from .telegram_handler import prompt_telegram
        return prompt_telegram(
            request,
            bot_token=self.telegram_token,
            chat_id=self.telegram_chat_id,
            timeout_seconds=self.timeout_seconds,
        )

    def _request_gateway(self, request: ConsentRequest) -> ConsentResponse:
        """Tier 3: Full gateway. Needs `requests`."""
        try:
            import requests as http
        except ImportError:
            raise ImportError(
                "Gateway mode requires the 'requests' library. "
                "Install with: pip install acp-sdk[remote]"
            )

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if self.gateway_api_key:
            headers["Authorization"] = f"Bearer {self.gateway_api_key}"

        body: Dict[str, Any] = {
            "agent_id": request.agent.id,
            "agent_name": request.agent.name,
            "agent_framework": request.agent.framework,
            "session_id": request.agent.session_id,
            "action": request.action.to_dict(),
            "timeout_seconds": self.timeout_seconds,
        }
        if request.context:
            body["context"] = request.context.to_dict()

        url = self.gateway_url.rstrip("/")  # type: ignore[union-attr]

        resp = http.post(
            f"{url}/api/v1/consent/request",
            json=body,
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        # Auto-approved or auto-denied by gateway policy
        if data.get("auto_approved"):
            return ConsentResponse(
                request_id=data["request_id"],
                decision=ConsentDecision.APPROVED,
                approver_id="policy_auto",
                channel="gateway",
                reason=data.get("reason", "Auto-approved by policy"),
                auto_approved=True,
            )

        if data.get("auto_denied") or resp.status_code == 403:
            return ConsentResponse(
                request_id=data.get("request_id", ""),
                decision=ConsentDecision.DENIED,
                approver_id="policy_auto",
                channel="gateway",
                reason=data.get("reason", "Blocked by policy"),
            )

        # Poll for human response
        request_id = data["request_id"]
        start = time.time()
        while time.time() - start < self.timeout_seconds:
            time.sleep(2)
            poll = http.get(
                f"{url}/api/v1/consent/{request_id}",
                headers=headers,
                timeout=30,
            )
            poll.raise_for_status()
            status_data = poll.json()

            status = status_data.get("status")
            if status == "pending":
                continue

            if status in ("approved", "denied", "expired"):
                response_data = status_data.get("response")
                if response_data:
                    return ConsentResponse.from_dict(response_data)
                return ConsentResponse(
                    request_id=request_id,
                    decision=(
                        ConsentDecision.APPROVED
                        if status == "approved"
                        else ConsentDecision.DENIED
                    ),
                    channel="gateway",
                    reason=f"Status: {status}",
                )

        return ConsentResponse(
            request_id=request_id,
            decision=ConsentDecision.DENIED,
            approver_id="system_timeout",
            channel="gateway",
            reason="Request timed out",
        )
