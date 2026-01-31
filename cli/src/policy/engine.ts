/**
 * Policy Engine
 *
 * Evaluates YAML policy rules against tool calls to determine
 * the action: allow, ask, or deny.
 *
 * Rules are evaluated in order (top to bottom). First match wins.
 * If no rule matches, default_action applies.
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

export class PolicyEngine {
  private policy: Policy;

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
   * Evaluate a tool call against the policy.
   */
  evaluate(tool: string, args: Record<string, unknown>): PolicyResult {
    const classification = this.classify(tool);

    for (let i = 0; i < this.policy.rules.length; i++) {
      const rule = this.policy.rules[i];

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
