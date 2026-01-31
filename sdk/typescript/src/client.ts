/**
 * ACP TypeScript SDK — Client
 *
 * Lightweight client. Uses only `fetch` (built into Node 18+).
 * Zero external dependencies.
 *
 * Auto-detects mode from environment:
 *   - ACP_GATEWAY_URL → gateway mode
 *   - Default → throws (TypeScript SDK needs a gateway URL)
 */

import type {
  ACPClientConfig,
  ConsentRequestOptions,
  ConsentResponse,
  ConsentProof,
  CreateConsentResult,
} from './types.js';
import { ConsentDenied, ConsentTimeout, ConsentBlocked } from './types.js';

/**
 * Represents a pending consent request that can be polled.
 */
export class PendingConsent {
  constructor(
    private client: ACPClient,
    public readonly requestId: string,
    public readonly expiresAt: string
  ) {}

  /**
   * Poll the gateway until a decision is made or timeout is reached.
   */
  async waitForDecision(options?: {
    pollInterval?: number;
    timeout?: number;
  }): Promise<ConsentResponse> {
    const pollInterval = options?.pollInterval ?? 2000;
    const timeout = options?.timeout ?? 900_000;
    const start = Date.now();

    while (true) {
      if (Date.now() - start > timeout) {
        throw new ConsentTimeout(this.requestId, Math.floor(timeout / 1000));
      }

      const status = await this.client.checkStatus(this.requestId);

      if (status.status === 'approved' && status.response) {
        return status.response;
      }

      if (status.status === 'denied') {
        throw new ConsentDenied(
          status.response?.reason || 'Denied by approver',
          this.requestId
        );
      }

      if (status.status === 'expired') {
        throw new ConsentTimeout(this.requestId);
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }
}

/**
 * ACP Client for TypeScript.
 *
 * Uses only the built-in `fetch` API — zero dependencies.
 *
 * @example
 * ```ts
 * const client = new ACPClient({
 *   gatewayUrl: 'http://localhost:3000',
 *   agentId: 'my_agent',
 * });
 *
 * const consent = await client.requestConsent({
 *   tool: 'send_email',
 *   parameters: { to: 'ceo@co.com' },
 *   description: 'Send quarterly report',
 *   riskLevel: 'high',
 * });
 *
 * const response = await consent.waitForDecision();
 * ```
 */
export class ACPClient {
  private gatewayUrl: string;
  private agentId: string;
  private apiKey?: string;
  private agentName?: string;
  private agentFramework?: string;
  private sessionId?: string;
  private defaultTimeout: number;

  constructor(config: ACPClientConfig) {
    this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;
    this.agentName = config.agentName;
    this.agentFramework = config.agentFramework;
    this.sessionId = config.sessionId;
    this.defaultTimeout = config.defaultTimeout ?? 900;
  }

  /**
   * Submit a consent request to the gateway.
   * Returns a PendingConsent that can be polled for the decision.
   *
   * If the policy auto-approves, returns immediately.
   * If the policy blocks, throws ConsentBlocked.
   */
  async requestConsent(options: ConsentRequestOptions): Promise<PendingConsent> {
    const body = {
      agent_id: this.agentId,
      agent_name: this.agentName,
      agent_framework: this.agentFramework,
      session_id: this.sessionId,
      action: {
        tool: options.tool,
        category: options.category || 'data',
        risk_level: options.riskLevel || 'medium',
        parameters: options.parameters,
        description: options.description,
        estimated_impact: options.estimatedImpact,
      },
      context: options.context,
      timeout_seconds: options.timeoutSeconds || this.defaultTimeout,
    };

    const response = await this._fetch('/api/v1/consent/request', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (response.status === 403) {
      const data = (await response.json()) as CreateConsentResult;
      throw new ConsentBlocked(data.reason, data.request_id);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ACP Gateway error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as CreateConsentResult;

    if (data.auto_approved) {
      return new AutoApprovedConsent(data);
    }

    return new PendingConsent(this, data.request_id, data.expires_at || '');
  }

  /** Check the status of a consent request. */
  async checkStatus(
    requestId: string
  ): Promise<{ status: string; response?: ConsentResponse }> {
    const response = await this._fetch(`/api/v1/consent/${requestId}`);
    if (!response.ok) {
      throw new Error(`Failed to check status: ${response.status}`);
    }
    return response.json();
  }

  /** Get the cryptographic proof for an approved request. */
  async getProof(requestId: string): Promise<{
    request_id: string;
    status: string;
    proof: ConsentProof;
    valid_until: string;
  }> {
    const response = await this._fetch(`/api/v1/consent/${requestId}/proof`);
    if (!response.ok) {
      throw new Error(`Failed to get proof: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Wrap an async function with ACP consent.
   *
   * @example
   * ```ts
   * const safeSend = client.wrap(sendEmail, {
   *   tool: 'send_email',
   *   riskLevel: 'high',
   * });
   * await safeSend('user@co.com', 'Subject', 'Body');
   * ```
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: {
      tool: string;
      category?: string;
      riskLevel?: string;
      description?: string;
    }
  ): T {
    const client = this;

    const wrapped = async (...args: any[]) => {
      const consent = await client.requestConsent({
        tool: options.tool,
        parameters: { args },
        description: options.description || `Execute ${options.tool}`,
        category: options.category as any,
        riskLevel: options.riskLevel as any,
      });

      await consent.waitForDecision();
      return fn(...args);
    };

    return wrapped as T;
  }

  private async _fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return fetch(`${this.gatewayUrl}${path}`, { ...init, headers });
  }
}

/** Auto-approved consent — resolves immediately without polling. */
class AutoApprovedConsent extends PendingConsent {
  private data: CreateConsentResult;

  constructor(data: CreateConsentResult) {
    super(null as any, data.request_id, '');
    this.data = data;
  }

  async waitForDecision(): Promise<ConsentResponse> {
    return {
      type: 'consent_response',
      version: '0.1.0',
      request_id: this.data.request_id,
      timestamp: new Date().toISOString(),
      decision: 'approved',
      approver: { id: 'policy_engine', channel: 'auto' },
      modifications: null,
      conditions: { valid_until: '' },
      nonce: '',
      proof: this.data.proof || {
        algorithm: 'Ed25519',
        public_key: '',
        signature: '',
        signed_payload_hash: '',
      },
    };
  }
}
