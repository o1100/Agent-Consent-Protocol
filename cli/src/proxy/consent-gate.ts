/**
 * Consent Gate — The decision point
 *
 * Sits between the MCP proxy and upstream servers.
 * For each tool call:
 *   1. Classify the action (category, risk level)
 *   2. Evaluate policy (allow / ask / deny)
 *   3. If "ask": send to human via channel adapter, wait for response
 *   4. If approved: inject credentials from vault
 *   5. Return decision to proxy
 */

import { PolicyEngine } from '../policy/engine.js';
import { CredentialVault } from '../sandbox/credentials.js';
import { AuditLogger } from '../audit/logger.js';

// Channel adapter interface — implemented by terminal, telegram, webhook
export interface ChannelAdapter {
  name: string;
  requestConsent(request: ConsentDisplayRequest): Promise<ConsentDecision>;
}

export interface ConsentDisplayRequest {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  category: string;
  riskLevel: string;
  policyRule?: string;
}

export interface ConsentDecision {
  approved: boolean;
  reason?: string;
  modifications?: Record<string, unknown>;
}

interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
  requestId: string | number;
}

interface ConsentResult {
  allowed: boolean;
  reason?: string;
  response?: string;
  category?: string;
  riskLevel?: string;
  modifiedArgs?: Record<string, unknown>;
}

interface ConsentGateOptions {
  policyEngine: PolicyEngine;
  channel: ChannelAdapter;
  vault: CredentialVault;
  auditLogger: AuditLogger;
  config: Record<string, unknown>;
}

export class ConsentGate {
  private policyEngine: PolicyEngine;
  private channel: ChannelAdapter;
  private vault: CredentialVault;
  private auditLogger: AuditLogger;

  constructor(options: ConsentGateOptions) {
    this.policyEngine = options.policyEngine;
    this.channel = options.channel;
    this.vault = options.vault;
    this.auditLogger = options.auditLogger;
  }

  /**
   * Process a tool call through the consent gate.
   *
   * This is the core decision loop:
   * 1. Classify the tool call
   * 2. Check policy
   * 3. Ask human if needed
   * 4. Inject credentials if approved
   */
  async process(request: ToolCallRequest): Promise<ConsentResult> {
    // 1. Classify the tool call
    const classification = this.policyEngine.classify(request.tool);

    // 2. Evaluate policy
    const policyResult = this.policyEngine.evaluate(request.tool, request.arguments);

    // Log policy evaluation
    this.auditLogger.record({
      event_type: 'policy_evaluated',
      agent: 'sandbox-agent',
      tool: request.tool,
      category: classification.category,
      risk_level: classification.riskLevel,
      decision: policyResult.action,
      metadata: {
        rule_id: policyResult.ruleId,
        rule_name: policyResult.ruleName,
      },
    });

    // 3. Act on policy decision
    switch (policyResult.action) {
      case 'allow': {
        // Auto-approved by policy
        return {
          allowed: true,
          category: classification.category,
          riskLevel: classification.riskLevel,
          modifiedArgs: this.injectCredentials(request.arguments),
        };
      }

      case 'deny': {
        return {
          allowed: false,
          reason: policyResult.reason || 'Denied by policy.',
          category: classification.category,
          riskLevel: classification.riskLevel,
        };
      }

      case 'ask': {
        // Request human consent
        const consentId = `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        console.log(`  📋 Consent required for: ${request.tool} [${classification.riskLevel.toUpperCase()}]`);

        const decision = await this.channel.requestConsent({
          id: consentId,
          tool: request.tool,
          arguments: request.arguments,
          category: classification.category,
          riskLevel: classification.riskLevel,
          policyRule: policyResult.ruleName,
        });

        // Log the decision
        this.auditLogger.record({
          event_type: decision.approved ? 'consent_approved' : 'consent_denied',
          agent: 'sandbox-agent',
          tool: request.tool,
          category: classification.category,
          risk_level: classification.riskLevel,
          decision: decision.approved ? 'approved' : 'denied',
          metadata: {
            consent_id: consentId,
            reason: decision.reason,
            channel: this.channel.name,
          },
        });

        if (decision.approved) {
          const args = decision.modifications
            ? { ...request.arguments, ...decision.modifications }
            : request.arguments;

          return {
            allowed: true,
            category: classification.category,
            riskLevel: classification.riskLevel,
            modifiedArgs: this.injectCredentials(args),
          };
        } else {
          return {
            allowed: false,
            reason: decision.reason || 'Denied by human.',
            category: classification.category,
            riskLevel: classification.riskLevel,
          };
        }
      }

      default:
        return {
          allowed: false,
          reason: `Unknown policy action: ${policyResult.action}`,
          category: classification.category,
          riskLevel: classification.riskLevel,
        };
    }
  }

  /**
   * Inject credentials from the vault into tool call arguments.
   *
   * Looks for argument values that match vault key patterns
   * (e.g., "$VAULT:SMTP_PASSWORD") and replaces them with actual values.
   */
  private injectCredentials(args: Record<string, unknown>): Record<string, unknown> {
    const injected = { ...args };

    for (const [key, value] of Object.entries(injected)) {
      if (typeof value === 'string' && value.startsWith('$VAULT:')) {
        const secretKey = value.slice(7);
        const secretValue = this.vault.get(secretKey);
        if (secretValue) {
          injected[key] = secretValue;
        }
      }
    }

    return injected;
  }
}
