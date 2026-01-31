/**
 * ACP TypeScript SDK — Client
 *
 * Two modes:
 * 1. Local: Terminal prompt via readline (default)
 * 2. Gateway: Full ACP gateway with policies & crypto
 */

import * as crypto from 'node:crypto';
import * as readline from 'node:readline';
import type {
  ACPClientOptions,
  ConsentRequest,
  ConsentResponse,
  RequestConsentOptions,
  RiskLevel,
  ActionCategory,
} from './types.js';

const DEFAULT_CLASSIFICATIONS: Record<string, { category: ActionCategory; risk: RiskLevel }> = {
  web_search: { category: 'data', risk: 'low' },
  read_file: { category: 'data', risk: 'low' },
  write_file: { category: 'data', risk: 'medium' },
  delete_file: { category: 'data', risk: 'high' },
  send_email: { category: 'communication', risk: 'high' },
  send_tweet: { category: 'public', risk: 'high' },
  execute_shell: { category: 'system', risk: 'high' },
  transfer_money: { category: 'financial', risk: 'critical' },
  deploy_production: { category: 'system', risk: 'critical' },
};

const RISK_EMOJI: Record<string, string> = {
  low: '🟢', medium: '🟡', high: '🔴', critical: '⛔',
};

export class ACPClient {
  private options: Required<
    Pick<ACPClientOptions, 'agentId' | 'timeoutSeconds' | 'autoApproveLowRisk'>
  > & ACPClientOptions;
  private mode: 'local' | 'gateway';

  constructor(options: ACPClientOptions) {
    this.options = {
      timeoutSeconds: 900,
      autoApproveLowRisk: false,
      ...options,
    };

    const gwUrl = options.gatewayUrl || process.env.ACP_GATEWAY_URL;
    if (options.mode) {
      this.mode = options.mode;
    } else if (gwUrl) {
      this.mode = 'gateway';
      this.options.gatewayUrl = gwUrl;
      this.options.gatewayApiKey = options.gatewayApiKey || process.env.ACP_GATEWAY_API_KEY;
    } else {
      this.mode = 'local';
    }
  }

  async requestConsent(opts: RequestConsentOptions): Promise<ConsentResponse> {
    // Auto-classify
    const classification = DEFAULT_CLASSIFICATIONS[opts.tool];
    const category = opts.category || classification?.category || 'data';
    const riskLevel = opts.risk_level || classification?.risk || 'medium';

    // Build request
    const request: ConsentRequest = {
      type: 'consent_request',
      version: '0.1.0',
      id: `cr_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      timestamp: new Date().toISOString(),
      agent: {
        id: this.options.agentId,
        name: this.options.agentName,
        framework: this.options.framework,
        session_id: opts.session_id,
      },
      action: {
        tool: opts.tool,
        description: opts.description,
        category,
        risk_level: riskLevel,
        parameters: opts.parameters || {},
        estimated_impact: opts.estimated_impact,
      },
      nonce: `n_${crypto.randomUUID()}`,
    };

    // Auto-approve low risk
    if (this.options.autoApproveLowRisk && riskLevel === 'low') {
      return {
        request_id: request.id,
        decision: 'approved',
        timestamp: new Date().toISOString(),
        approver_id: 'policy_auto',
        channel: 'auto',
        reason: 'Auto-approved: low risk',
        auto_approved: true,
      };
    }

    // Custom handler
    if (this.options.onConsent) {
      return this.options.onConsent(request);
    }

    if (this.mode === 'gateway') {
      return this.requestGateway(request);
    }
    return this.requestLocal(request);
  }

  private async requestLocal(request: ConsentRequest): Promise<ConsentResponse> {
    const risk = request.action.risk_level || 'medium';
    const emoji = RISK_EMOJI[risk] || '❓';

    console.log('\n' + '═'.repeat(60));
    console.log('  🤖 AGENT CONSENT REQUEST');
    console.log('═'.repeat(60));
    console.log(`  Agent:       ${request.agent.name || request.agent.id}`);
    console.log(`  Action:      ${request.action.tool}`);
    console.log(`  Risk:        ${emoji} ${risk.toUpperCase()}`);
    console.log(`  Category:    ${request.action.category}`);
    console.log('─'.repeat(60));
    console.log(`  Description: ${request.action.description}`);
    if (request.action.parameters && Object.keys(request.action.parameters).length > 0) {
      console.log('  Parameters:');
      console.log(`  ${JSON.stringify(request.action.parameters, null, 2).split('\n').join('\n  ')}`);
    }
    console.log('═'.repeat(60));

    const answer = await this.prompt('  [A]pprove or [D]eny? ');
    const approved = answer.toLowerCase().startsWith('a');
    console.log(`\n  → ${approved ? '✅ Approved' : '❌ Denied'}\n`);

    return {
      request_id: request.id,
      decision: approved ? 'approved' : 'denied',
      timestamp: new Date().toISOString(),
      approver_id: 'local_user',
      channel: 'terminal',
    };
  }

  private async requestGateway(request: ConsentRequest): Promise<ConsentResponse> {
    const url = this.options.gatewayUrl!.replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.gatewayApiKey) {
      headers['Authorization'] = `Bearer ${this.options.gatewayApiKey}`;
    }

    const body = {
      agent_id: request.agent.id,
      agent_name: request.agent.name,
      agent_framework: request.agent.framework,
      session_id: request.agent.session_id,
      action: request.action,
      timeout_seconds: this.options.timeoutSeconds,
    };

    const resp = await fetch(`${url}/api/v1/consent/request`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await resp.json() as any;

    if (data.auto_approved) {
      return {
        request_id: data.request_id,
        decision: 'approved',
        timestamp: new Date().toISOString(),
        approver_id: 'policy_auto',
        channel: 'gateway',
        auto_approved: true,
      };
    }

    if (data.auto_denied) {
      return {
        request_id: data.request_id,
        decision: 'denied',
        timestamp: new Date().toISOString(),
        approver_id: 'policy_auto',
        channel: 'gateway',
        reason: data.reason,
      };
    }

    // Poll for response
    const requestId = data.request_id;
    const deadline = Date.now() + (this.options.timeoutSeconds ?? 900) * 1000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`${url}/api/v1/consent/${requestId}`, { headers });
      const status = await poll.json() as any;

      if (status.status === 'pending') continue;

      return {
        request_id: requestId,
        decision: status.status === 'approved' ? 'approved' : 'denied',
        timestamp: new Date().toISOString(),
        approver_id: status.response?.approver?.id || 'unknown',
        channel: status.response?.approver?.channel || 'gateway',
        reason: status.response?.reason,
        proof: status.response?.proof,
      };
    }

    return {
      request_id: requestId,
      decision: 'denied',
      timestamp: new Date().toISOString(),
      approver_id: 'system_timeout',
      channel: 'gateway',
      reason: 'Request timed out',
    };
  }

  private prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
      rl.question(question, answer => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

/**
 * Error thrown when consent is denied.
 */
export class ConsentDeniedError extends Error {
  response: ConsentResponse;
  constructor(message: string, response: ConsentResponse) {
    super(message);
    this.name = 'ConsentDeniedError';
    this.response = response;
  }
}

/**
 * Create a consent-wrapped function.
 */
export function requiresConsent(
  riskLevel: RiskLevel = 'medium',
  options?: { category?: ActionCategory; description?: string }
) {
  return function <T extends (...args: any[]) => any>(
    _target: any,
    propertyKey: string,
    descriptor: TypeDescriptor<T>
  ) {
    const original = descriptor.value!;
    descriptor.value = async function (...args: any[]) {
      // Get or create a client from the instance
      const client: ACPClient = (this as any)._acpClient || new ACPClient({ agentId: 'default' });

      const response = await client.requestConsent({
        tool: propertyKey,
        description: options?.description || `Execute ${propertyKey}`,
        parameters: args.length === 1 && typeof args[0] === 'object' ? args[0] : { args },
        risk_level: riskLevel,
        category: options?.category,
      });

      if (response.decision === 'approved' || response.decision === 'approved_with_modifications') {
        return original.apply(this, args);
      }

      throw new ConsentDeniedError(
        `Consent denied for ${propertyKey}: ${response.reason || 'No reason given'}`,
        response
      );
    } as any;
    return descriptor;
  };
}

interface TypeDescriptor<T> {
  value?: T;
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
}
