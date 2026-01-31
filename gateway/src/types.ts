/**
 * ACP Gateway — Protocol Types
 *
 * All TypeScript types for the Agent Consent Protocol messages,
 * policies, audit events, and internal structures.
 */

// ─── Action Taxonomy ────────────────────────────────────────────────

export type ActionCategory =
  | 'communication'
  | 'financial'
  | 'data'
  | 'system'
  | 'public'
  | 'identity'
  | 'physical';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ConsentDecision =
  | 'approved'
  | 'approved_with_modifications'
  | 'denied'
  | 'escalated'
  | 'deferred';

export type ConsentStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'executed'
  | 'failed';

export type PolicyDecisionType =
  | 'auto_approve'
  | 'ask_once_per_session'
  | 'ask_once_per_pattern'
  | 'always_ask'
  | 'never_allow'
  | 'require_multiple_approvers'
  | 'delegate'
  | 'time_bound_auto';

// ─── Consent Request ────────────────────────────────────────────────

export interface AgentInfo {
  id: string;
  name?: string;
  framework?: string;
  session_id?: string;
}

export interface ActionInfo {
  tool: string;
  category: ActionCategory;
  risk_level: RiskLevel;
  parameters: Record<string, unknown>;
  description: string;
  estimated_impact?: string;
}

export interface RequestContext {
  conversation_summary?: string;
  previous_actions?: string[];
  trigger?: 'user_request' | 'autonomous' | 'scheduled' | 'event_driven';
}

export interface ConsentRequest {
  type: 'consent_request';
  version: string;
  id: string;
  timestamp: string;
  expires_at: string;
  agent: AgentInfo;
  action: ActionInfo;
  context?: RequestContext;
  policy_ref?: string;
  nonce: string;
  callback_url?: string;
}

// ─── Consent Response ───────────────────────────────────────────────

export interface ApproverInfo {
  id: string;
  channel: string;
  device_fingerprint?: string;
}

export interface ConsentConditions {
  valid_until: string;
  max_retries?: number;
  require_exact_params?: boolean;
}

export interface ConsentProof {
  algorithm: 'Ed25519';
  public_key: string;
  signature: string;
  signed_payload_hash: string;
}

export interface ConsentResponse {
  type: 'consent_response';
  version: string;
  request_id: string;
  timestamp: string;
  decision: ConsentDecision;
  approver: ApproverInfo;
  modifications?: Record<string, unknown> | null;
  conditions: ConsentConditions;
  reason?: string;
  nonce: string;
  proof: ConsentProof;
}

// ─── Policy Types ───────────────────────────────────────────────────

export interface PolicyRuleMatch {
  risk_level?: RiskLevel[];
  category?: ActionCategory[];
  agent_id?: string[];
}

export interface TimeOfDayCondition {
  after: string;   // "HH:MM"
  before: string;  // "HH:MM"
  timezone?: string;
}

export interface PolicyRuleConditions {
  time_of_day?: TimeOfDayCondition;
}

export interface RateLimitConstraint {
  max_actions: number;
  window_seconds: number;
}

export interface PolicyRuleConstraints {
  max_amount?: number;
  currency?: string;
  daily_limit?: number;
  require_reason?: boolean;
  rate_limit?: RateLimitConstraint;
  blocked_patterns?: string[];
  allowed_patterns?: string[];
  trust_duration_seconds?: number;
}

export interface PolicyRule {
  id: string;
  name?: string;
  match?: PolicyRuleMatch;
  action_pattern?: string;
  decision: PolicyDecisionType;
  priority: number;
  require_multiple_approvers?: boolean;
  min_approvers?: number;
  conditions?: PolicyRuleConditions;
  constraints?: PolicyRuleConstraints;
  message?: string;
}

export interface PolicyDefaults {
  unmatched_action: PolicyDecisionType;
  timeout_seconds: number;
  reminder_seconds?: number;
  max_pending_requests?: number;
  notification_channels?: string[];
}

export interface Policy {
  type: 'policy';
  version: string;
  id: string;
  name: string;
  description?: string;
  rules: PolicyRule[];
  defaults: PolicyDefaults;
}

// ─── Audit Events ───────────────────────────────────────────────────

export type AuditEventType =
  | 'consent_requested'
  | 'consent_delivered'
  | 'consent_viewed'
  | 'consent_approved'
  | 'consent_denied'
  | 'consent_modified'
  | 'consent_expired'
  | 'consent_cancelled'
  | 'consent_escalated'
  | 'action_executed'
  | 'action_succeeded'
  | 'action_failed'
  | 'policy_evaluated'
  | 'policy_auto_approved'
  | 'policy_auto_denied';

export interface AuditEvent {
  type: 'audit_event';
  version: string;
  id: string;
  timestamp: string;
  event_type: AuditEventType;
  request_id: string;
  agent_id: string;
  approver_id?: string;
  action_tool: string;
  action_category: ActionCategory;
  action_risk_level: RiskLevel;
  decision?: string;
  response_time_ms?: number;
  policy_evaluated?: string;
  policy_result?: string;
  metadata?: Record<string, unknown>;
  previous_event_hash: string | null;
  event_hash: string;
}

// ─── Internal Storage Types ─────────────────────────────────────────

export interface StoredConsentRequest {
  id: string;
  status: ConsentStatus;
  request: ConsentRequest;
  response?: ConsentResponse;
  created_at: string;
  updated_at: string;
  expires_at: string;
  policy_decision?: PolicyDecisionType;
}

// ─── API Types ──────────────────────────────────────────────────────

export interface CreateConsentRequestBody {
  agent_id: string;
  agent_name?: string;
  agent_framework?: string;
  session_id?: string;
  action: {
    tool: string;
    category: ActionCategory;
    risk_level: RiskLevel;
    parameters: Record<string, unknown>;
    description: string;
    estimated_impact?: string;
  };
  context?: RequestContext;
  timeout_seconds?: number;
}

export interface RespondToConsentBody {
  decision: ConsentDecision;
  approver_id: string;
  channel: string;
  modifications?: Record<string, unknown>;
  reason?: string;
}

export interface PolicyEvaluation {
  action: PolicyDecisionType;
  rule_id?: string;
  rule_name?: string;
  reason: string;
  category: ActionCategory;
  risk_level: RiskLevel;
  constraints?: PolicyRuleConstraints;
}

// ─── Channel Adapter Interface ──────────────────────────────────────

export interface ChannelAdapter {
  name: string;
  deliverRequest(request: ConsentRequest): Promise<void>;
  cancelRequest(requestId: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}
