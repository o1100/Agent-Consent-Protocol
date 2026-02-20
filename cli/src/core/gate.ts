/**
 * ConsentGate — the decision engine
 *
 * One function: (action: Action) => Promise<Verdict>
 *
 * For each action:
 *   1. Evaluate policy (allow / ask / deny)
 *   2. If "ask": send to channel (push notification), wait for response
 *   3. Log to audit trail
 *   4. Return verdict
 */

import type { Action, Verdict } from './types.js';
import type { Policy } from './policy.js';
import type { Channel } from './channel.js';
import type { AuditLog } from './audit.js';

export type ConsentGate = (action: Action) => Promise<Verdict>;

export interface GateOptions {
  policy: Policy;
  channel: Channel;
  audit: AuditLog;
}

export function createGate(options: GateOptions): ConsentGate {
  const { policy, channel, audit } = options;

  return async (action: Action): Promise<Verdict> => {
    const result = policy.evaluate(action);
    console.log(`  [gate] ${action.name} ${(action.args || '').substring(0, 60)} -> policy: ${result.action} (${result.reason})`);
    let verdict: Verdict;

    switch (result.action) {
      case 'allow':
        verdict = { decision: 'allow', reason: result.reason };
        break;

      case 'deny':
        verdict = { decision: 'deny', reason: result.reason };
        break;

      case 'ask': {
        const timeoutMs = (result.timeout || 120) * 1000;
        const response = await channel.ask(action, timeoutMs);
        verdict = response.approved
          ? { decision: 'allow', reason: 'Approved by human' }
          : { decision: 'deny', reason: response.reason || 'Denied by human' };
        break;
      }

      default:
        verdict = { decision: 'deny', reason: `Unknown policy action: ${result.action}` };
    }

    audit.append(action, verdict);
    return verdict;
  };
}
