"""
Agent Consent Protocol (ACP) — 2FA for AI Agents.

Add human consent to any AI agent in 2 lines of code:

    from acp import requires_consent

    @requires_consent("high")
    def send_email(to, body):
        ...

Three tiers, progressive complexity:
- Tier 1 (Local): Terminal prompt. Zero dependencies.
- Tier 2 (Remote): Set ACP_TELEGRAM_TOKEN → mobile approvals.
- Tier 3 (Production): Full gateway with Ed25519 crypto.
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
)

__all__ = [
    # Core
    "requires_consent",
    "ACPClient",
    "ConsentDeniedError",
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
