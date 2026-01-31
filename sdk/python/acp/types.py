"""
ACP — Types and Built-in Risk Classification

Zero external dependencies. Everything here uses Python stdlib only.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


# ─── Enums ───────────────────────────────────────────────────────

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
    DENIED = "denied"
    APPROVED_WITH_MODIFICATIONS = "approved_with_modifications"
    EXPIRED = "expired"


class ConsentStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"


# ─── Built-in Tool Classification ────────────────────────────────
#
# Convention over configuration: common tools have sensible defaults.
# Users only override if they disagree.

_TOOL_CLASSIFICATIONS: Dict[str, Tuple[ActionCategory, RiskLevel]] = {
    # Data — Low risk (read-only)
    "web_search":           (ActionCategory.DATA, RiskLevel.LOW),
    "search":               (ActionCategory.DATA, RiskLevel.LOW),
    "search_web":           (ActionCategory.DATA, RiskLevel.LOW),
    "read_file":            (ActionCategory.DATA, RiskLevel.LOW),
    "read":                 (ActionCategory.DATA, RiskLevel.LOW),
    "list_files":           (ActionCategory.DATA, RiskLevel.LOW),
    "list_directory":       (ActionCategory.DATA, RiskLevel.LOW),
    "get_weather":          (ActionCategory.DATA, RiskLevel.LOW),
    "calculator":           (ActionCategory.DATA, RiskLevel.LOW),
    "lookup":               (ActionCategory.DATA, RiskLevel.LOW),
    "fetch_url":            (ActionCategory.DATA, RiskLevel.LOW),
    "get_time":             (ActionCategory.DATA, RiskLevel.LOW),
    "git_status":           (ActionCategory.SYSTEM, RiskLevel.LOW),
    "git_log":              (ActionCategory.SYSTEM, RiskLevel.LOW),
    "git_diff":             (ActionCategory.SYSTEM, RiskLevel.LOW),

    # Data — Medium risk (writes)
    "write_file":           (ActionCategory.DATA, RiskLevel.MEDIUM),
    "create_file":          (ActionCategory.DATA, RiskLevel.MEDIUM),
    "edit_file":            (ActionCategory.DATA, RiskLevel.MEDIUM),
    "update_file":          (ActionCategory.DATA, RiskLevel.MEDIUM),
    "sql_query":            (ActionCategory.DATA, RiskLevel.MEDIUM),
    "db_query":             (ActionCategory.DATA, RiskLevel.MEDIUM),

    # Data — High risk (destructive)
    "delete_file":          (ActionCategory.DATA, RiskLevel.HIGH),
    "remove_file":          (ActionCategory.DATA, RiskLevel.HIGH),
    "truncate_table":       (ActionCategory.DATA, RiskLevel.HIGH),

    # Data — Critical (irreversible)
    "delete_database":      (ActionCategory.DATA, RiskLevel.CRITICAL),
    "drop_table":           (ActionCategory.DATA, RiskLevel.CRITICAL),
    "drop_database":        (ActionCategory.DATA, RiskLevel.CRITICAL),

    # Communication — Medium
    "send_slack_message":   (ActionCategory.COMMUNICATION, RiskLevel.MEDIUM),
    "send_slack":           (ActionCategory.COMMUNICATION, RiskLevel.MEDIUM),
    "send_discord_message": (ActionCategory.COMMUNICATION, RiskLevel.MEDIUM),
    "send_message":         (ActionCategory.COMMUNICATION, RiskLevel.MEDIUM),
    "create_calendar":      (ActionCategory.COMMUNICATION, RiskLevel.MEDIUM),
    "create_event":         (ActionCategory.COMMUNICATION, RiskLevel.MEDIUM),

    # Communication — High
    "send_email":           (ActionCategory.COMMUNICATION, RiskLevel.HIGH),
    "send_sms":             (ActionCategory.COMMUNICATION, RiskLevel.HIGH),
    "send_notification":    (ActionCategory.COMMUNICATION, RiskLevel.HIGH),

    # Public — High
    "send_tweet":           (ActionCategory.PUBLIC, RiskLevel.HIGH),
    "post_tweet":           (ActionCategory.PUBLIC, RiskLevel.HIGH),
    "create_post":          (ActionCategory.PUBLIC, RiskLevel.HIGH),
    "publish":              (ActionCategory.PUBLIC, RiskLevel.HIGH),
    "post_comment":         (ActionCategory.PUBLIC, RiskLevel.MEDIUM),
    "post_github_comment":  (ActionCategory.PUBLIC, RiskLevel.MEDIUM),

    # System — High
    "execute_shell":        (ActionCategory.SYSTEM, RiskLevel.HIGH),
    "run_command":          (ActionCategory.SYSTEM, RiskLevel.HIGH),
    "shell":                (ActionCategory.SYSTEM, RiskLevel.HIGH),
    "exec":                 (ActionCategory.SYSTEM, RiskLevel.HIGH),
    "bash":                 (ActionCategory.SYSTEM, RiskLevel.HIGH),
    "git_push":             (ActionCategory.SYSTEM, RiskLevel.HIGH),
    "git_commit":           (ActionCategory.SYSTEM, RiskLevel.MEDIUM),

    # System — Critical
    "deploy":               (ActionCategory.SYSTEM, RiskLevel.CRITICAL),
    "deploy_production":    (ActionCategory.SYSTEM, RiskLevel.CRITICAL),
    "modify_dns":           (ActionCategory.SYSTEM, RiskLevel.CRITICAL),
    "restart_service":      (ActionCategory.SYSTEM, RiskLevel.CRITICAL),
    "shutdown":             (ActionCategory.SYSTEM, RiskLevel.CRITICAL),

    # Financial — High/Critical
    "transfer_money":       (ActionCategory.FINANCIAL, RiskLevel.CRITICAL),
    "make_payment":         (ActionCategory.FINANCIAL, RiskLevel.CRITICAL),
    "purchase":             (ActionCategory.FINANCIAL, RiskLevel.HIGH),
    "create_order":         (ActionCategory.FINANCIAL, RiskLevel.HIGH),
    "refund":               (ActionCategory.FINANCIAL, RiskLevel.HIGH),
    "subscribe":            (ActionCategory.FINANCIAL, RiskLevel.HIGH),

    # Physical
    "unlock_door":          (ActionCategory.PHYSICAL, RiskLevel.HIGH),
    "lock_door":            (ActionCategory.PHYSICAL, RiskLevel.MEDIUM),
    "set_thermostat":       (ActionCategory.PHYSICAL, RiskLevel.MEDIUM),
    "turn_on":              (ActionCategory.PHYSICAL, RiskLevel.MEDIUM),
    "turn_off":             (ActionCategory.PHYSICAL, RiskLevel.MEDIUM),

    # Identity
    "change_password":      (ActionCategory.IDENTITY, RiskLevel.CRITICAL),
    "update_profile":       (ActionCategory.IDENTITY, RiskLevel.MEDIUM),
    "revoke_token":         (ActionCategory.IDENTITY, RiskLevel.HIGH),
}

# Patterns for prefix-based matching
_TOOL_PREFIXES: Dict[str, Tuple[ActionCategory, RiskLevel]] = {
    "read_":    (ActionCategory.DATA, RiskLevel.LOW),
    "get_":     (ActionCategory.DATA, RiskLevel.LOW),
    "list_":    (ActionCategory.DATA, RiskLevel.LOW),
    "fetch_":   (ActionCategory.DATA, RiskLevel.LOW),
    "search_":  (ActionCategory.DATA, RiskLevel.LOW),
    "send_":    (ActionCategory.COMMUNICATION, RiskLevel.HIGH),
    "delete_":  (ActionCategory.DATA, RiskLevel.HIGH),
    "remove_":  (ActionCategory.DATA, RiskLevel.HIGH),
    "create_":  (ActionCategory.DATA, RiskLevel.MEDIUM),
    "update_":  (ActionCategory.DATA, RiskLevel.MEDIUM),
    "deploy_":  (ActionCategory.SYSTEM, RiskLevel.CRITICAL),
    "post_":    (ActionCategory.PUBLIC, RiskLevel.HIGH),
}


def classify_tool(
    tool_name: str,
    override_category: Optional[str] = None,
    override_risk: Optional[str] = None,
) -> Tuple[ActionCategory, RiskLevel]:
    """
    Classify a tool by name into a category and risk level.

    Uses built-in mappings first, then prefix heuristics, then defaults.
    Explicit overrides always win.
    """
    # Explicit overrides always win
    cat = ActionCategory(override_category) if override_category else None
    risk = RiskLevel(override_risk) if override_risk else None

    if cat and risk:
        return cat, risk

    # Exact match
    normalized = tool_name.lower().strip()
    if normalized in _TOOL_CLASSIFICATIONS:
        auto_cat, auto_risk = _TOOL_CLASSIFICATIONS[normalized]
        return cat or auto_cat, risk or auto_risk

    # Prefix match
    for prefix, (p_cat, p_risk) in _TOOL_PREFIXES.items():
        if normalized.startswith(prefix):
            return cat or p_cat, risk or p_risk

    # Default: medium risk data operation
    return cat or ActionCategory.DATA, risk or RiskLevel.MEDIUM


# ─── Dataclasses ─────────────────────────────────────────────────

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
    parameters: Dict[str, Any] = field(default_factory=dict)
    description: str = ""
    estimated_impact: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool": self.tool,
            "category": self.category.value,
            "risk_level": self.risk_level.value,
            "parameters": self.parameters,
            "description": self.description,
            "estimated_impact": self.estimated_impact,
        }


@dataclass
class RequestContext:
    conversation_summary: Optional[str] = None
    previous_actions: Optional[List[str]] = None
    trigger: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "conversation_summary": self.conversation_summary,
            "previous_actions": self.previous_actions,
            "trigger": self.trigger,
        }


@dataclass
class ConsentProof:
    algorithm: str
    public_key: str
    signature: str
    signed_payload_hash: str


@dataclass
class ConsentRequest:
    """Internal representation of a consent request."""
    action: ActionInfo
    agent: AgentInfo
    context: Optional[RequestContext] = None
    id: str = field(default_factory=lambda: f"cr_{uuid.uuid4().hex[:20]}")
    nonce: str = field(default_factory=lambda: f"n_{uuid.uuid4().hex}")
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    expires_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "id": self.id,
            "agent": {"id": self.agent.id, "name": self.agent.name},
            "action": self.action.to_dict(),
            "nonce": self.nonce,
            "timestamp": self.timestamp,
        }
        if self.context:
            d["context"] = self.context.to_dict()
        return d


@dataclass
class ConsentResponse:
    """The result of a consent prompt — approved, denied, etc."""
    request_id: str
    decision: ConsentDecision
    approver_id: str = "unknown"
    channel: str = "local"
    reason: Optional[str] = None
    proof: Optional[ConsentProof] = None
    modifications: Optional[Dict[str, Any]] = None
    auto_approved: bool = False

    @property
    def approved(self) -> bool:
        return self.decision in (
            ConsentDecision.APPROVED,
            ConsentDecision.APPROVED_WITH_MODIFICATIONS,
        )

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "ConsentResponse":
        """Parse a gateway JSON response."""
        proof = None
        if data.get("proof"):
            p = data["proof"]
            proof = ConsentProof(
                algorithm=p.get("algorithm", "Ed25519"),
                public_key=p.get("public_key", ""),
                signature=p.get("signature", ""),
                signed_payload_hash=p.get("signed_payload_hash", ""),
            )

        return ConsentResponse(
            request_id=data.get("request_id", ""),
            decision=ConsentDecision(data.get("decision", "denied")),
            approver_id=data.get("approver", {}).get("id", "unknown"),
            channel=data.get("approver", {}).get("channel", "gateway"),
            reason=data.get("reason"),
            proof=proof,
            modifications=data.get("modifications"),
        )
