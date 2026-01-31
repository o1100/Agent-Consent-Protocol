/**
 * ACP TypeScript SDK — Types
 */

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
  | 'cancelled';

export interface ActionInfo {
  tool: string;
  description: string;
  category?: ActionCategory;
  risk_level?: RiskLevel;
  parameters?: Record<string, unknown>;
  estimated_impact?: string;
}

export interface AgentInfo {
  id: string;
  name?: string;
  framework?: string;
  session_id?: string;
}

export interface ConsentProof {
  algorithm: 'Ed25519';
  public_key: string;
  signature: string;
  signed_payload_hash: string;
}

export interface ConsentRequest {
  type: 'consent_request';
  version: string;
  id: string;
  timestamp: string;
  expires_at?: string;
  agent: AgentInfo;
  action: ActionInfo;
  nonce: string;
}

export interface ConsentResponse {
  request_id: string;
  decision: ConsentDecision;
  timestamp: string;
  approver_id: string;
  channel: string;
  reason?: string;
  modifications?: Record<string, unknown>;
  proof?: ConsentProof;
  auto_approved?: boolean;
}

export interface ACPClientOptions {
  agentId: string;
  agentName?: string;
  framework?: string;
  gatewayUrl?: string;
  gatewayApiKey?: string;
  mode?: 'local' | 'gateway';
  autoApproveLowRisk?: boolean;
  timeoutSeconds?: number;
  onConsent?: (request: ConsentRequest) => Promise<ConsentResponse>;
}

export interface RequestConsentOptions {
  tool: string;
  description: string;
  parameters?: Record<string, unknown>;
  category?: ActionCategory;
  risk_level?: RiskLevel;
  estimated_impact?: string;
  session_id?: string;
}
