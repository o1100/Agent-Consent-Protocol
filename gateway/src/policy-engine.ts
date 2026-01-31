/**
 * ACP Gateway — Policy Engine
 *
 * Declarative policy evaluation engine that determines how each
 * action should be handled: auto-approve, always-ask, never-allow, etc.
 *
 * Policies are loaded from JSON files and can be hot-reloaded.
 * Rules are evaluated in priority order (highest first), first match wins.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ActionCategory,
  ActionInfo,
  AgentInfo,
  Policy,
  PolicyDecisionType,
  PolicyEvaluation,
  PolicyRule,
  RiskLevel,
} from './types.js';
import type { ConsentStore } from './consent-store.js';

// Default tool classifications for common tools
const DEFAULT_CLASSIFICATIONS: Record<string, { category: ActionCategory; risk: RiskLevel }> = {
  web_search:           { category: 'data',          risk: 'low' },
  read_file:            { category: 'data',          risk: 'low' },
  write_file:           { category: 'data',          risk: 'medium' },
  delete_file:          { category: 'data',          risk: 'high' },
  send_slack_message:   { category: 'communication', risk: 'medium' },
  send_email:           { category: 'communication', risk: 'high' },
  send_tweet:           { category: 'public',        risk: 'high' },
  execute_shell:        { category: 'system',        risk: 'high' },
  deploy_production:    { category: 'system',        risk: 'critical' },
  transfer_money:       { category: 'financial',     risk: 'critical' },
  delete_database:      { category: 'data',          risk: 'critical' },
  create_calendar:      { category: 'communication', risk: 'medium' },
  git_push:             { category: 'system',        risk: 'high' },
  modify_dns:           { category: 'system',        risk: 'critical' },
  post_github_comment:  { category: 'public',        risk: 'medium' },
  unlock_door:          { category: 'physical',      risk: 'high' },
};

export class PolicyEngine {
  private policy: Policy;
  private store?: ConsentStore;
  private policyPath?: string;
  private lastLoadTime: number = 0;

  constructor(policyOrPath: Policy | string, store?: ConsentStore) {
    this.store = store;

    if (typeof policyOrPath === 'string') {
      this.policyPath = policyOrPath;
      this.policy = this.loadFromFile(policyOrPath);
    } else {
      this.policy = policyOrPath;
    }

    // Sort rules by priority (highest first)
    this.policy.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Load policy from a JSON file.
   */
  private loadFromFile(filePath: string): Policy {
    const resolved = path.resolve(filePath);
    const content = fs.readFileSync(resolved, 'utf-8');
    this.lastLoadTime = Date.now();
    return JSON.parse(content) as Policy;
  }

  /**
   * Reload policy from file if it has changed.
   */
  reload(): boolean {
    if (!this.policyPath) return false;

    try {
      const stat = fs.statSync(this.policyPath);
      if (stat.mtimeMs > this.lastLoadTime) {
        this.policy = this.loadFromFile(this.policyPath);
        this.policy.rules.sort((a, b) => b.priority - a.priority);
        return true;
      }
    } catch {
      // File not accessible, keep current policy
    }
    return false;
  }

  /**
   * Get the current policy.
   */
  getPolicy(): Policy {
    return this.policy;
  }

  /**
   * Update the policy in memory and optionally persist to file.
   */
  updatePolicy(policy: Policy, persist: boolean = true): void {
    this.policy = policy;
    this.policy.rules.sort((a, b) => b.priority - a.priority);

    if (persist && this.policyPath) {
      fs.writeFileSync(this.policyPath, JSON.stringify(policy, null, 2), 'utf-8');
      this.lastLoadTime = Date.now();
    }
  }

  /**
   * Classify a tool call if category/risk aren't provided.
   */
  classifyAction(tool: string, providedCategory?: ActionCategory, providedRisk?: RiskLevel): {
    category: ActionCategory;
    risk_level: RiskLevel;
  } {
    // Use provided values if available
    if (providedCategory && providedRisk) {
      return { category: providedCategory, risk_level: providedRisk };
    }

    // Check default classifications
    const defaultClassification = DEFAULT_CLASSIFICATIONS[tool];
    return {
      category: providedCategory || defaultClassification?.category || 'data',
      risk_level: providedRisk || defaultClassification?.risk || 'medium',
    };
  }

  /**
   * Evaluate a policy for a given action.
   *
   * Returns the policy decision: what should happen with this action.
   * Rules are evaluated in priority order (highest priority first).
   * First matching rule wins.
   */
  evaluate(
    action: ActionInfo,
    agent: AgentInfo,
    sessionId?: string
  ): PolicyEvaluation {
    // Try to hot-reload if using file-based policy
    this.reload();

    const classification = this.classifyAction(
      action.tool,
      action.category,
      action.risk_level
    );

    // Check each rule in priority order
    for (const rule of this.policy.rules) {
      if (this.matchesRule(rule, classification, action, agent)) {
        // Check time-of-day conditions
        if (rule.conditions?.time_of_day && !this.isWithinTimeWindow(rule.conditions.time_of_day)) {
          continue; // Time condition not met, skip this rule
        }

        // Check rate limits
        if (rule.constraints?.rate_limit && this.store) {
          const count = this.store.getActionCount(
            classification.category,
            rule.constraints.rate_limit.window_seconds
          );
          if (count >= rule.constraints.rate_limit.max_actions) {
            return {
              action: 'always_ask',
              rule_id: rule.id,
              rule_name: rule.name,
              reason: `Rate limit exceeded: ${count}/${rule.constraints.rate_limit.max_actions} actions in window`,
              category: classification.category,
              risk_level: classification.risk_level,
              constraints: rule.constraints,
            };
          }
        }

        // Check session-based approvals for ask_once policies
        if (
          (rule.decision === 'ask_once_per_session' || rule.decision === 'ask_once_per_pattern') &&
          sessionId &&
          this.store?.hasSessionApproval(sessionId, action.tool)
        ) {
          return {
            action: 'auto_approve',
            rule_id: rule.id,
            rule_name: rule.name,
            reason: `Previously approved in session (rule: ${rule.name || rule.id})`,
            category: classification.category,
            risk_level: classification.risk_level,
          };
        }

        // Check blocked patterns
        if (rule.constraints?.blocked_patterns) {
          const paramStr = JSON.stringify(action.parameters);
          for (const pattern of rule.constraints.blocked_patterns) {
            if (paramStr.includes(pattern)) {
              return {
                action: 'never_allow',
                rule_id: rule.id,
                rule_name: rule.name,
                reason: `Action contains blocked pattern: "${pattern}"`,
                category: classification.category,
                risk_level: classification.risk_level,
              };
            }
          }
        }

        return {
          action: rule.decision,
          rule_id: rule.id,
          rule_name: rule.name,
          reason: rule.message || `Matched rule: ${rule.name || rule.id}`,
          category: classification.category,
          risk_level: classification.risk_level,
          constraints: rule.constraints,
        };
      }
    }

    // No rule matched — use default
    return {
      action: this.policy.defaults.unmatched_action,
      reason: 'No policy rule matched — using default action',
      category: classification.category,
      risk_level: classification.risk_level,
    };
  }

  /**
   * Check if an action matches a policy rule.
   */
  private matchesRule(
    rule: PolicyRule,
    classification: { category: ActionCategory; risk_level: RiskLevel },
    action: ActionInfo,
    agent: AgentInfo
  ): boolean {
    const match = rule.match;

    // If no match criteria, rule matches everything
    if (!match && !rule.action_pattern) {
      return true;
    }

    // Check category
    if (match?.category && match.category.length > 0) {
      if (!match.category.includes(classification.category)) {
        return false;
      }
    }

    // Check risk level
    if (match?.risk_level && match.risk_level.length > 0) {
      if (!match.risk_level.includes(classification.risk_level)) {
        return false;
      }
    }

    // Check agent ID
    if (match?.agent_id && match.agent_id.length > 0) {
      if (!match.agent_id.includes(agent.id)) {
        return false;
      }
    }

    // Check action pattern (glob-like matching)
    if (rule.action_pattern) {
      if (!this.matchesPattern(action.tool, rule.action_pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Simple glob-like pattern matching for action names.
   * Supports: * (any characters), ? (single character)
   */
  private matchesPattern(tool: string, pattern: string): boolean {
    // Convert glob to regex
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
      .replace(/\*/g, '.*')                     // * → .*
      .replace(/\?/g, '.');                     // ? → .

    return new RegExp(`^${regexStr}$`).test(tool);
  }

  /**
   * Check if the current time is within a time-of-day window.
   */
  private isWithinTimeWindow(
    timeOfDay: { after: string; before: string; timezone?: string }
  ): boolean {
    const now = new Date();
    // Simple hour:minute comparison (timezone support would need a library)
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    const [afterH, afterM] = timeOfDay.after.split(':').map(Number);
    const [beforeH, beforeM] = timeOfDay.before.split(':').map(Number);
    const afterMinutes = afterH * 60 + afterM;
    const beforeMinutes = beforeH * 60 + beforeM;

    if (afterMinutes <= beforeMinutes) {
      // Simple range: e.g., 09:00 - 17:00
      return currentMinutes >= afterMinutes && currentMinutes < beforeMinutes;
    } else {
      // Wraps midnight: e.g., 23:00 - 07:00
      return currentMinutes >= afterMinutes || currentMinutes < beforeMinutes;
    }
  }
}
