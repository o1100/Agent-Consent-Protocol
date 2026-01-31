/**
 * Agent Consent Protocol (ACP) — TypeScript SDK
 *
 * 2FA for AI Agents. Add human consent to any AI agent.
 */

export { ACPClient, ConsentDeniedError, requiresConsent } from './client.js';
export { acpExpressMiddleware, acpMCPToolWrapper, acpWrapMCPTools } from './middleware.js';
export type {
  ActionCategory,
  ActionInfo,
  AgentInfo,
  ACPClientOptions,
  ConsentDecision,
  ConsentProof,
  ConsentRequest,
  ConsentResponse,
  ConsentStatus,
  RequestConsentOptions,
  RiskLevel,
} from './types.js';
