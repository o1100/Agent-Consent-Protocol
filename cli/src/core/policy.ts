/**
 * Policy — YAML rules, top-to-bottom, first match wins
 *
 * Loads a YAML policy file and evaluates actions against rules.
 * Supports glob matching for names, args, and hosts.
 *
 * Policy format:
 *   default: ask
 *   wrap: [gh, git, curl, ...]
 *   rules:
 *     - match: { name: "cat" }
 *       action: allow
 *     - match: { kind: http, host: "*.evil.com" }
 *       action: deny
 */

import fs from 'node:fs';
import { parse as yamlParse } from 'yaml';
import type { Action, PolicyConfig, PolicyRule } from './types.js';

export interface PolicyResult {
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  timeout?: number;
}

export class Policy {
  private config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = config;
  }

  get wrap(): string[] {
    return this.config.wrap || [];
  }

  get defaultAction(): 'allow' | 'ask' | 'deny' {
    return this.config.default;
  }

  /** Prepend a rule so it's evaluated first. */
  prependRule(rule: PolicyRule): void {
    this.config.rules.unshift(rule);
  }

  evaluate(action: Action): PolicyResult {
    for (let i = 0; i < this.config.rules.length; i++) {
      const rule = this.config.rules[i];
      if (this.matches(rule, action)) {
        return {
          action: rule.action,
          reason: `Matched rule ${i + 1}`,
          timeout: rule.timeout,
        };
      }
    }

    return {
      action: this.config.default,
      reason: 'No rule matched, using default',
    };
  }

  private matches(rule: PolicyRule, action: Action): boolean {
    const match = rule.match;
    if (!match) return true;

    if (match.kind && action.meta.kind !== match.kind) return false;
    if (match.name && !globMatch(action.name, match.name)) return false;
    if (match.args && !globMatch(action.args || '', match.args)) return false;
    if (match.host && !globMatch(action.meta.host || '', match.host)) return false;
    if (match.method && action.meta.method !== match.method) return false;

    return true;
  }
}

/**
 * Simple glob matching: * matches any characters, ? matches one character.
 */
export function globMatch(value: string, pattern: string): boolean {
  if (pattern === '*') return true;

  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0DOUBLESTAR\0')
    .replace(/\*/g, '.*')
    .replace(/\0DOUBLESTAR\0/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexStr}$`).test(value);
}

export function loadPolicy(filePath: string): Policy {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parsePolicy(content);
}

export function parsePolicy(yamlContent: string): Policy {
  const raw = yamlParse(yamlContent) as Partial<PolicyConfig>;
  const config: PolicyConfig = {
    default: raw.default || 'ask',
    wrap: raw.wrap || [],
    rules: raw.rules || [],
  };
  return new Policy(config);
}
