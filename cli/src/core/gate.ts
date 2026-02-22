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
  const httpApprovalCache = new Map<string, number>();
  const hostApprovalTtlMs = readPositiveIntEnv('ACP_HTTP_HOST_APPROVAL_TTL_SEC', 180) * 1000;

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
        const cachedAllowReason = resolveHttpApprovalCacheReason(action, httpApprovalCache);
        if (cachedAllowReason) {
          verdict = { decision: 'allow', reason: cachedAllowReason };
          break;
        }

        const timeoutMs = (result.timeout || 120) * 1000;
        const response = await channel.ask(action, timeoutMs);
        verdict = response.approved
          ? { decision: 'allow', reason: 'Approved by human' }
          : { decision: 'deny', reason: response.reason || 'Denied by human' };

        if (verdict.decision === 'allow' && action.meta.kind === 'http') {
          storeHttpApprovalCache(action, httpApprovalCache, hostApprovalTtlMs);
        }
        break;
      }

      default:
        verdict = { decision: 'deny', reason: `Unknown policy action: ${result.action}` };
    }

    audit.append(action, verdict);
    return verdict;
  };
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveHttpApprovalCacheReason(
  action: Action,
  cache: Map<string, number>,
): string | null {
  if (action.meta.kind !== 'http') return null;
  const host = normalizeHost(action.meta.host);
  if (!host) return null;

  const now = Date.now();
  pruneExpiredHostCache(cache, now);
  const expiresAt = cache.get(host);
  if (!expiresAt || expiresAt <= now) return null;
  console.log(`  [gate] ${action.name} ${host} -> cached allow (recent human approval)`);
  return 'Approved by human (cached host approval)';
}

function storeHttpApprovalCache(
  action: Action,
  cache: Map<string, number>,
  ttlMs: number,
): void {
  const host = normalizeHost(action.meta.host);
  if (!host) return;

  const expiresAt = Date.now() + ttlMs;
  cache.set(host, expiresAt);

  const twin = getWwwTwin(host);
  if (twin) {
    cache.set(twin, expiresAt);
  }
}

function pruneExpiredHostCache(cache: Map<string, number>, now: number): void {
  for (const [host, expiresAt] of cache.entries()) {
    if (expiresAt <= now) {
      cache.delete(host);
    }
  }
}

function normalizeHost(host: string | undefined): string | null {
  if (!host) return null;
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  return normalized.length > 0 ? normalized : null;
}

function getWwwTwin(host: string): string | null {
  if (host.startsWith('www.')) {
    const stripped = host.slice(4);
    return stripped.length > 0 ? stripped : null;
  }
  if (host.includes('.')) {
    return `www.${host}`;
  }
  return null;
}
