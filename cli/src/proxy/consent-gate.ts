/**
 * Consent Gate — The decision point
 *
 * Sits between the MCP proxy and upstream servers.
 * For each tool call:
 *   1. Classify the action (category, risk level)
 *   2. Evaluate policy (allow / ask / deny)
 *   3. If "ask": send to human via channel adapter, wait for response
 *   4. If approved: create cryptographic consent proof, inject credentials
 *   5. Return decision to proxy
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PolicyEngine } from '../policy/engine.js';
import { CredentialVault } from '../sandbox/credentials.js';
import { AuditLogger } from '../audit/logger.js';
import { loadPrivateKey, canonicalJSON, sha256, generateNonce } from '../crypto/keys.js';
import type { InterceptionKind } from '../interceptors/types.js';

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

export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
  requestId: string | number;
  kind?: InterceptionKind;
}

export interface ConsentProof {
  consent_id: string;
  tool: string;
  arguments_hash: string;
  decision: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

interface ConsentResult {
  allowed: boolean;
  reason?: string;
  response?: string;
  category?: string;
  riskLevel?: string;
  modifiedArgs?: Record<string, unknown>;
  consent_proof?: ConsentProof;
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
  private privateKey: crypto.KeyObject | null = null;
  private privateKeyHex: string | null = null;

  constructor(options: ConsentGateOptions) {
    this.policyEngine = options.policyEngine;
    this.channel = options.channel;
    this.vault = options.vault;
    this.auditLogger = options.auditLogger;
    this.loadSigningKey();
  }

  /**
   * Load the Ed25519 private key for consent proof signing.
   */
  private loadSigningKey(): void {
    const keyPath = path.join(os.homedir(), '.acp', 'keys', 'private.key');
    try {
      if (fs.existsSync(keyPath)) {
        this.privateKeyHex = fs.readFileSync(keyPath, 'utf-8').trim();
        this.privateKey = loadPrivateKey(this.privateKeyHex);
      }
    } catch {
      console.warn('  ⚠️  Could not load signing key from ~/.acp/keys/private.key');
      console.warn('  Consent proofs will not be cryptographically signed.');
    }
  }

  /**
   * Create a cryptographic consent proof signed with the Ed25519 private key.
   */
  private createConsentProof(
    consentId: string,
    tool: string,
    args: Record<string, unknown>,
    decision: string
  ): ConsentProof | undefined {
    if (!this.privateKey) return undefined;

    const timestamp = new Date().toISOString();
    const nonce = generateNonce();
    const argumentsHash = sha256(canonicalJSON(args));

    const proofPayload = {
      arguments_hash: argumentsHash,
      consent_id: consentId,
      decision,
      nonce,
      timestamp,
      tool,
    };

    const canonical = canonicalJSON(proofPayload);
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), this.privateKey);

    return {
      consent_id: consentId,
      tool,
      arguments_hash: argumentsHash,
      decision,
      timestamp,
      nonce,
      signature: signature.toString('hex'),
    };
  }

  /**
   * Process a tool call through the consent gate.
   *
   * This is the core decision loop:
   * 1. Classify the tool call
   * 2. Check policy
   * 3. Ask human if needed
   * 4. Create consent proof if approved
   * 5. Inject credentials if approved
   */
  async process(request: ToolCallRequest): Promise<ConsentResult> {
    // 1. Classify the tool call
    const classification = this.policyEngine.classify(request.tool);

    // 2. Evaluate policy
    const policyResult = this.policyEngine.evaluate(request.tool, request.arguments, request.kind);

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
        kind: request.kind || 'mcp',
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
          reason: policyResult.reason || `Denied by policy: tool "${request.tool}" is blocked${policyResult.ruleName ? ` (${policyResult.ruleName})` : ''}.`,
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

        // Create consent proof if we have a signing key
        const decisionStr = decision.approved ? 'approved' : 'denied';
        const consentProof = this.createConsentProof(
          consentId,
          request.tool,
          request.arguments,
          decisionStr
        );

        // Log the decision with consent proof
        this.auditLogger.record({
          event_type: decision.approved ? 'consent_approved' : 'consent_denied',
          agent: 'sandbox-agent',
          tool: request.tool,
          category: classification.category,
          risk_level: classification.riskLevel,
          decision: decisionStr,
          metadata: {
            consent_id: consentId,
            reason: decision.reason,
            channel: this.channel.name,
            consent_proof: consentProof ? {
              arguments_hash: consentProof.arguments_hash,
              nonce: consentProof.nonce,
              signature: consentProof.signature,
              timestamp: consentProof.timestamp,
            } : undefined,
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
            consent_proof: consentProof,
          };
        } else {
          return {
            allowed: false,
            reason: decision.reason || 'Denied by human.',
            category: classification.category,
            riskLevel: classification.riskLevel,
            consent_proof: consentProof,
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
