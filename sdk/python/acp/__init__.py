"""
Agent Consent Protocol (ACP) — 2FA for AI Agents.

Add human consent to any AI agent action in 3 lines:

    from acp import requires_consent

    @requires_consent("high")
    def send_email(to, subject, body):
        ...

That's it. Zero config. Works immediately with a terminal prompt.

Progressive complexity:
  - Tier 1 (default): Terminal prompt. Zero dependencies, zero config.
  - Tier 2: Set ACP_TELEGRAM_TOKEN env var → mobile approvals via Telegram.
  - Tier 3: Set ACP_GATEWAY_URL env var → full gateway with crypto & audit.
"""

__version__ = "0.1.0"

from .decorators import requires_consent, ConsentDeniedError
from .client import ACPClient
from .types import (
    ActionCategory,
    ActionInfo,
    AgentInfo,
    ConsentDecision,
    ConsentProof,
    ConsentRequest,
    ConsentResponse,
    ConsentStatus,
    RequestContext,
    RiskLevel,
    classify_tool,
)

__all__ = [
    # Core — this is what 90% of users need
    "requires_consent",
    "ConsentDeniedError",
    # Advanced
    "ACPClient",
    "classify_tool",
    # Types
    "ActionCategory",
    "ActionInfo",
    "AgentInfo",
    "ConsentDecision",
    "ConsentProof",
    "ConsentRequest",
    "ConsentResponse",
    "ConsentStatus",
    "RequestContext",
    "RiskLevel",
]
