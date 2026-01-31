"""
ACP Python SDK — Protocol Types

Dataclasses for all Agent Consent Protocol messages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class ActionCategory(str, Enum):
    COMMUNICATION = "communication"
    FINANCIAL = "financial"
    DATA = "data"
    SYSTEM = "system"
    PUBLIC = "public"
    IDENTITY = "identity"
    PHYSICAL = "physical"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ConsentDecision(str, Enum):
    APPROVED = "approved"
    APPROVED_WITH_MODIFICATIONS = "approved_with_modifications"
    DENIED = "denied"
    ESCALATED = "escalated"
    DEFERRED = "deferred"


class ConsentStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    EXECUTED = "executed"
    FAILED = "failed"


@dataclass
class AgentInfo:
    id: str
    name: Optional[str] = None
    framework: Optional[str] = None
    session_id: Optional[str] = None


@dataclass
class ActionInfo:
    tool: str
    category: ActionCategory
    risk_level: RiskLevel
    parameters: dict[str, Any] = field(default_factory=dict)
    description: str = ""
    estimated_impact: Optional[str] = None


@dataclass
class RequestContext:
    conversation_summary: Optional[str] = None
    previous_actions: Optional[list[str]] = None
    trigger: Optional[str] = None


@dataclass
class ConsentProof:
    algorithm: str
    public_key: str
    signature: str
    signed_payload_hash: str


@dataclass
class ConsentConditions:
    valid_until: str
    max_retries: Optional[int] = None
    require_exact_params: Optional[bool] = None


@dataclass
class ApproverInfo:
    id: str
    channel: str
    device_fingerprint: Optional[str] = None


@dataclass
class ConsentRequest:
    """A consent request sent from the SDK to the gateway."""
    id: str
    agent: AgentInfo
    action: ActionInfo
    nonce: str
    timestamp: str
    expires_at: str
    version: str = "0.1.0"
    context: Optional[RequestContext] = None
    policy_ref: Optional[str] = None
    callback_url: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to a dictionary suitable for JSON serialization."""
        result: dict[str, Any] = {
            "type": "consent_request",
            "version": self.version,
            "id": self.id,
            "timestamp": self.timestamp,
            "expires_at": self.expires_at,
            "agent": {
                "id": self.agent.id,
                "name": self.agent.name,
                "framework": self.agent.framework,
                "session_id": self.agent.session_id,
            },
            "action": {
                "tool": self.action.tool,
                "category": self.action.category.value,
                "risk_level": self.action.risk_level.value,
                "parameters": self.action.parameters,
                "description": self.action.description,
            },
            "nonce": self.nonce,
        }
        if self.context:
            result["context"] = {
                "conversation_summary": self.context.conversation_summary,
                "previous_actions": self.context.previous_actions,
                "trigger": self.context.trigger,
            }
        return result


@dataclass
class ConsentResponse:
    """A consent response received from the gateway."""
    request_id: str
    decision: ConsentDecision
    timestamp: str
    approver: ApproverInfo
    conditions: ConsentConditions
    nonce: str
    proof: ConsentProof
    modifications: Optional[dict[str, Any]] = None
    reason: Optional[str] = None

    def apply_modifications(self, params: dict[str, Any]) -> dict[str, Any]:
        """Apply approved modifications to the original parameters."""
        if not self.modifications:
            return params
        result = dict(params)
        for key, value in self.modifications.items():
            # Support dotted path keys like "action.parameters.text"
            parts = key.split(".")
            target = result
            for part in parts[:-1]:
                if part in target and isinstance(target[part], dict):
                    target = target[part]
                else:
                    break
            target[parts[-1]] = value
        return result


@dataclass
class PolicyEvaluation:
    """Result of evaluating a policy for an action."""
    action: str  # auto_approve, always_ask, never_allow, etc.
    rule_id: Optional[str] = None
    rule_name: Optional[str] = None
    reason: str = ""
    category: Optional[ActionCategory] = None
    risk_level: Optional[RiskLevel] = None
    auto_approved: bool = False
    auto_denied: bool = False


class ConsentDenied(Exception):
    """Raised when a consent request is denied by the approver."""

    def __init__(self, reason: Optional[str] = None, request_id: Optional[str] = None):
        self.reason = reason or "Action denied by approver"
        self.request_id = request_id
        super().__init__(self.reason)


class ConsentTimeout(Exception):
    """Raised when a consent request times out."""

    def __init__(self, request_id: Optional[str] = None, timeout_seconds: Optional[int] = None):
        self.request_id = request_id
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"Consent request timed out after {timeout_seconds}s"
            if timeout_seconds
            else "Consent request timed out"
        )


class ConsentBlocked(Exception):
    """Raised when an action is blocked by policy (never_allow)."""

    def __init__(self, reason: Optional[str] = None, request_id: Optional[str] = None):
        self.reason = reason or "Action blocked by policy"
        self.request_id = request_id
        super().__init__(self.reason)
