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
 *
 * Supports interception kinds: mcp, shell, http, file, hook.
 * Tool names are namespaced: shell:curl, http:GET, file:rm, claude:Bash, etc.
 */

import type { InterceptionKind } from '../interceptors/types.js';

export interface PolicyRule {
  match?: {
    tool?: string;
    category?: string;
    server?: string;
    args?: Record<string, string>;
    kind?: InterceptionKind;
    host?: string;
    path?: string;
    command?: string;
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

// Exact match classifications for well-known MCP tools
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

// Shell command classifications (shell:command → classification)
const SHELL_CLASSIFICATIONS: Record<string, Classification> = {
  // Network
  'shell:curl':     { category: 'network', riskLevel: 'medium' },
  'shell:wget':     { category: 'network', riskLevel: 'medium' },
  'shell:ssh':      { category: 'network', riskLevel: 'high' },
  'shell:scp':      { category: 'network', riskLevel: 'high' },
  'shell:nc':       { category: 'network', riskLevel: 'high' },
  // Execution
  'shell:python':   { category: 'system', riskLevel: 'high' },
  'shell:python3':  { category: 'system', riskLevel: 'high' },
  'shell:node':     { category: 'system', riskLevel: 'high' },
  'shell:bash':     { category: 'system', riskLevel: 'high' },
  'shell:sh':       { category: 'system', riskLevel: 'high' },
  // Destructive
  'shell:rm':       { category: 'filesystem', riskLevel: 'high' },
  'shell:rmdir':    { category: 'filesystem', riskLevel: 'high' },
  'shell:mv':       { category: 'filesystem', riskLevel: 'medium' },
  'shell:chmod':    { category: 'filesystem', riskLevel: 'high' },
  // Package managers
  'shell:pip':      { category: 'system', riskLevel: 'medium' },
  'shell:pip3':     { category: 'system', riskLevel: 'medium' },
  'shell:npm':      { category: 'system', riskLevel: 'medium' },
  'shell:npx':      { category: 'system', riskLevel: 'high' },
  'shell:brew':     { category: 'system', riskLevel: 'medium' },
  // DevOps
  'shell:git':      { category: 'system', riskLevel: 'medium' },
  'shell:docker':   { category: 'system', riskLevel: 'critical' },
  'shell:kubectl':  { category: 'system', riskLevel: 'critical' },
};

// HTTP classifications
const HTTP_CLASSIFICATIONS: Record<string, Classification> = {
  'http:GET':       { category: 'network', riskLevel: 'low' },
  'http:HEAD':      { category: 'network', riskLevel: 'low' },
  'http:OPTIONS':   { category: 'network', riskLevel: 'low' },
  'http:POST':      { category: 'network', riskLevel: 'medium' },
  'http:PUT':       { category: 'network', riskLevel: 'medium' },
  'http:PATCH':     { category: 'network', riskLevel: 'medium' },
  'http:DELETE':    { category: 'network', riskLevel: 'high' },
  'http:CONNECT':   { category: 'network', riskLevel: 'medium' },
};

// File operation classifications
const FILE_CLASSIFICATIONS: Record<string, Classification> = {
  'file:read':      { category: 'filesystem', riskLevel: 'low' },
  'file:write':     { category: 'filesystem', riskLevel: 'medium' },
  'file:rm':        { category: 'filesystem', riskLevel: 'high' },
  'file:mkdir':     { category: 'filesystem', riskLevel: 'low' },
  'file:chmod':     { category: 'filesystem', riskLevel: 'high' },
  'file:rename':    { category: 'filesystem', riskLevel: 'medium' },
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
   * Checks namespaced classifications (shell:*, http:*, file:*) first,
   * then exact MCP matches, then pattern matches.
   */
  classify(tool: string): Classification {
    // Check shell classifications
    if (tool in SHELL_CLASSIFICATIONS) {
      return SHELL_CLASSIFICATIONS[tool];
    }

    // Check HTTP classifications
    if (tool in HTTP_CLASSIFICATIONS) {
      return HTTP_CLASSIFICATIONS[tool];
    }

    // Check file classifications
    if (tool in FILE_CLASSIFICATIONS) {
      return FILE_CLASSIFICATIONS[tool];
    }

    // Check exact MCP matches
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
  private checkRateLimit(tool: string, classification: Classification, args: Record<string, unknown>, kind?: InterceptionKind): string | null {
    for (const rule of this.policy.rules) {
      if (!rule.rate_limit) continue;

      // Check if this rate limit rule matches the tool
      if (!this.matchesRule(rule, tool, classification, args, kind)) continue;

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
   * Optionally accepts interception kind and extra context for extended matching.
   */
  evaluate(tool: string, args: Record<string, unknown>, kind?: InterceptionKind): PolicyResult {
    const classification = this.classify(tool);

    // Check rate limits before normal rule evaluation
    const rateLimitReason = this.checkRateLimit(tool, classification, args, kind);
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

      if (this.matchesRule(rule, tool, classification, args, kind)) {
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
   * Extended to support kind, host, path, and command matching.
   */
  private matchesRule(
    rule: PolicyRule,
    tool: string,
    classification: Classification,
    args: Record<string, unknown>,
    kind?: InterceptionKind
  ): boolean {
    const match = rule.match;
    if (!match) return true; // No match criteria = matches everything

    // Check interception kind
    if (match.kind) {
      if (!kind || kind !== match.kind) {
        return false;
      }
    }

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

    // Check host (for HTTP interceptions — matches against args.host)
    if (match.host) {
      const host = String(args.host || '');
      if (!this.globMatch(host, match.host)) {
        return false;
      }
    }

    // Check path (for file interceptions — matches against args.path)
    if (match.path) {
      const filePath = String(args.path || '');
      if (!this.globMatch(filePath, match.path)) {
        return false;
      }
    }

    // Check command (for shell interceptions — matches against args.command)
    if (match.command) {
      const cmd = String(args.command || '');
      if (!this.globMatch(cmd, match.command)) {
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
   * Simple glob matching: * matches any characters, ** matches path separators too.
   */
  private globMatch(value: string, pattern: string): boolean {
    if (pattern === '*') return true;

    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0DOUBLESTAR\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\0DOUBLESTAR\0/g, '.*')
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
