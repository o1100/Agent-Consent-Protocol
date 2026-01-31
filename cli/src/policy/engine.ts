/**
 * Policy Engine
 *
 * Evaluates YAML policy rules against tool calls to determine
 * the action: allow, ask, or deny.
 *
 * Rules are evaluated in order (top to bottom). First match wins.
 * If no rule matches, default_action applies.
 *
 * Rate limiting is enforced via sliding window counters per tool name.
 */

export interface PolicyRule {
  match?: {
    tool?: string;
    category?: string;
    server?: string;
    args?: Record<string, string>;
  };
  action: 'allow' | 'ask' | 'deny';
  level?: string;
  timeout?: number;
  rate_limit?: string;
  conditions?: {
    time_of_day?: {
      after: string;
      before: string;
      timezone?: string;
    };
  };
}

export interface Policy {
  version: string;
  default_action: 'allow' | 'ask' | 'deny';
  rules: PolicyRule[];
}

export interface PolicyResult {
  action: 'allow' | 'ask' | 'deny';
  ruleId?: string;
  ruleName?: string;
  reason?: string;
  level?: string;
  timeout?: number;
}

export interface Classification {
  category: string;
  riskLevel: string;
}

interface RateLimitEntry {
  timestamps: number[];
}

interface ParsedRateLimit {
  count: number;
  windowMs: number;
}

// Default classifications for common tool name patterns
const PATTERN_CLASSIFICATIONS: Array<[RegExp, Classification]> = [
  [/^(read|get|list|search|query|fetch|find|check|view)_/, { category: 'read', riskLevel: 'low' }],
  [/^(write|create|update|set|add|insert|save)_/, { category: 'write', riskLevel: 'medium' }],
  [/^(send|email|message|notify|broadcast)_/, { category: 'communication', riskLevel: 'high' }],
  [/^(delete|remove|drop|destroy|purge|clear)_/, { category: 'system', riskLevel: 'high' }],
  [/^(deploy|exec|shell|run|execute|sudo)/, { category: 'system', riskLevel: 'high' }],
  [/^(transfer|pay|charge|refund|invoice|purchase|buy)_/, { category: 'financial', riskLevel: 'critical' }],
  [/^(publish|post|tweet|announce|release)_/, { category: 'public', riskLevel: 'high' }],
  [/^(unlock|open|close|toggle|activate)_/, { category: 'physical', riskLevel: 'high' }],
];

// Exact match classifications for well-known tools
const EXACT_CLASSIFICATIONS: Record<string, Classification> = {
  web_search:           { category: 'read', riskLevel: 'low' },
  read_file:            { category: 'read', riskLevel: 'low' },
  write_file:           { category: 'write', riskLevel: 'medium' },
  delete_file:          { category: 'system', riskLevel: 'high' },
  send_email:           { category: 'communication', riskLevel: 'high' },
  send_tweet:           { category: 'public', riskLevel: 'high' },
  execute_shell:        { category: 'system', riskLevel: 'high' },
  deploy_production:    { category: 'system', riskLevel: 'critical' },
  transfer_money:       { category: 'financial', riskLevel: 'critical' },
  git_push:             { category: 'system', riskLevel: 'high' },
  git_commit:           { category: 'write', riskLevel: 'medium' },
};

const WINDOW_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export class PolicyEngine {
  private policy: Policy;
  /** Sliding window rate limit tracker: tool name → timestamps of recent calls */
  private rateLimitBuckets: Map<string, RateLimitEntry> = new Map();

  constructor(policy: Policy) {
    this.policy = policy;
  }

  /**
   * Classify a tool call by name.
   */
  classify(tool: string): Classification {
    // Check exact matches first
    if (tool in EXACT_CLASSIFICATIONS) {
      return EXACT_CLASSIFICATIONS[tool];
    }

    // Check pattern matches
    for (const [pattern, classification] of PATTERN_CLASSIFICATIONS) {
      if (pattern.test(tool)) {
        return classification;
      }
    }

    // Default: unknown category, medium risk
    return { category: 'unknown', riskLevel: 'medium' };
  }

  /**
   * Parse a rate limit string like "20/minute" into count and window.
   */
  private parseRateLimit(rateLimit: string): ParsedRateLimit | null {
    const match = /^(\d+)\/(second|minute|hour|day)$/.exec(rateLimit);
    if (!match) return null;
    return {
      count: parseInt(match[1], 10),
      windowMs: WINDOW_MS[match[2]],
    };
  }

  /**
   * Check if a tool call exceeds any applicable rate limit.
   * Returns the rate limit reason string if exceeded, or null if OK.
   *
   * This does NOT record the call — recording happens separately after
   * we know the call will proceed.
   */
  private checkRateLimit(tool: string, classification: Classification, args: Record<string, unknown>): string | null {
    for (const rule of this.policy.rules) {
      if (!rule.rate_limit) continue;

      // Check if this rate limit rule matches the tool
      if (!this.matchesRule(rule, tool, classification, args)) continue;

      const parsed = this.parseRateLimit(rule.rate_limit);
      if (!parsed) continue;

      const now = Date.now();
      const bucket = this.rateLimitBuckets.get(tool);
      if (!bucket) continue; // No calls yet, can't be exceeded

      // Count calls within the sliding window
      const windowStart = now - parsed.windowMs;
      const recentCalls = bucket.timestamps.filter(ts => ts > windowStart);

      if (recentCalls.length >= parsed.count) {
        return `Rate limit exceeded: ${rule.rate_limit} for "${tool}" (${recentCalls.length} calls in window)`;
      }
    }
    return null;
  }

  /**
   * Record a tool call for rate limiting purposes.
   */
  recordToolCall(tool: string): void {
    let bucket = this.rateLimitBuckets.get(tool);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.rateLimitBuckets.set(tool, bucket);
    }
    bucket.timestamps.push(Date.now());

    // Prune old entries (older than 24h to keep memory bounded)
    const cutoff = Date.now() - 86_400_000;
    bucket.timestamps = bucket.timestamps.filter(ts => ts > cutoff);
  }

  /**
   * Evaluate a tool call against the policy.
   * Checks rate limits first, then matches rules.
   */
  evaluate(tool: string, args: Record<string, unknown>): PolicyResult {
    const classification = this.classify(tool);

    // Check rate limits before normal rule evaluation
    const rateLimitReason = this.checkRateLimit(tool, classification, args);
    if (rateLimitReason) {
      return {
        action: 'deny',
        reason: rateLimitReason,
      };
    }

    // Record this call for future rate limiting
    this.recordToolCall(tool);

    for (let i = 0; i < this.policy.rules.length; i++) {
      const rule = this.policy.rules[i];

      // Rules can be rate-limit-only (no action) — skip for action matching
      if (!rule.action) continue;

      if (this.matchesRule(rule, tool, classification, args)) {
        return {
          action: rule.action,
          ruleId: `rule_${i}`,
          ruleName: `Rule ${i + 1}`,
          level: rule.level,
          timeout: rule.timeout,
          reason: `Matched rule ${i + 1}`,
        };
      }
    }

    // No rule matched — use default
    return {
      action: this.policy.default_action,
      reason: 'No policy rule matched, using default action',
    };
  }

  /**
   * Check if a tool call matches a policy rule.
   */
  private matchesRule(
    rule: PolicyRule,
    tool: string,
    classification: Classification,
    args: Record<string, unknown>
  ): boolean {
    const match = rule.match;
    if (!match) return true; // No match criteria = matches everything

    // Check tool name (supports glob patterns)
    if (match.tool) {
      if (!this.globMatch(tool, match.tool)) {
        return false;
      }
    }

    // Check category
    if (match.category) {
      if (classification.category !== match.category) {
        return false;
      }
    }

    // Check argument patterns
    if (match.args) {
      for (const [key, pattern] of Object.entries(match.args)) {
        const argValue = String(args[key] || '');
        if (!this.globMatch(argValue, pattern)) {
          return false;
        }
      }
    }

    // Check time-of-day conditions
    if (rule.conditions?.time_of_day) {
      if (!this.isWithinTimeWindow(rule.conditions.time_of_day)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Simple glob matching: * matches any characters.
   */
  private globMatch(value: string, pattern: string): boolean {
    if (pattern === '*') return true;

    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${regexStr}$`).test(value);
  }

  /**
   * Check if current time is within a time window.
   */
  private isWithinTimeWindow(window: { after: string; before: string }): boolean {
    const now = new Date();
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    const [aH, aM] = window.after.split(':').map(Number);
    const [bH, bM] = window.before.split(':').map(Number);
    const after = aH * 60 + aM;
    const before = bH * 60 + bM;

    if (after <= before) {
      return minutes >= after && minutes < before;
    }
    return minutes >= after || minutes < before;
  }
}
