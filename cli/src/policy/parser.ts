/**
 * YAML Policy Parser
 *
 * Parses and validates ACP policy files.
 */

import fs from 'node:fs';
import { parse as yamlParse } from 'yaml';
import type { Policy } from './engine.js';

const VALID_ACTIONS = ['allow', 'ask', 'deny'];
const VALID_LEVELS = ['low', 'medium', 'high', 'critical'];
const VALID_CATEGORIES = [
  'read', 'write', 'communication', 'financial',
  'system', 'public', 'physical', 'identity', 'unknown',
];

export class PolicyParser {
  /**
   * Parse a YAML policy file.
   */
  static parseFile(filePath: string): Policy {
    const content = fs.readFileSync(filePath, 'utf-8');
    return PolicyParser.parse(content);
  }

  /**
   * Parse a YAML policy string.
   */
  static parse(yamlContent: string): Policy {
    const parsed = yamlParse(yamlContent) as Policy;

    // Ensure required fields
    if (!parsed.version) {
      parsed.version = '1';
    }
    if (!parsed.default_action) {
      parsed.default_action = 'ask';
    }
    if (!parsed.rules) {
      parsed.rules = [];
    }

    return parsed;
  }

  /**
   * Validate a parsed policy and return any errors.
   */
  static validate(policy: Policy): string[] {
    const errors: string[] = [];

    // Check version
    if (!policy.version) {
      errors.push('Missing "version" field');
    }

    // Check default action
    if (!VALID_ACTIONS.includes(policy.default_action)) {
      errors.push(`Invalid default_action: "${policy.default_action}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
    }

    // Validate rules
    if (!Array.isArray(policy.rules)) {
      errors.push('"rules" must be an array');
      return errors;
    }

    for (let i = 0; i < policy.rules.length; i++) {
      const rule = policy.rules[i];
      const prefix = `Rule ${i + 1}`;

      // Check action
      if (!rule.action) {
        errors.push(`${prefix}: Missing "action" field`);
      } else if (!VALID_ACTIONS.includes(rule.action)) {
        errors.push(`${prefix}: Invalid action "${rule.action}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
      }

      // Check level (optional)
      if (rule.level && !VALID_LEVELS.includes(rule.level)) {
        errors.push(`${prefix}: Invalid level "${rule.level}". Must be one of: ${VALID_LEVELS.join(', ')}`);
      }

      // Check timeout (optional)
      if (rule.timeout !== undefined && (typeof rule.timeout !== 'number' || rule.timeout <= 0)) {
        errors.push(`${prefix}: Timeout must be a positive number`);
      }

      // Check match criteria (optional)
      if (rule.match) {
        if (rule.match.category && !VALID_CATEGORIES.includes(rule.match.category)) {
          errors.push(`${prefix}: Invalid category "${rule.match.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        }
      }

      // Check rate_limit format (optional)
      if (rule.rate_limit) {
        const rateMatch = /^(\d+)\/(second|minute|hour|day)$/.exec(rule.rate_limit);
        if (!rateMatch) {
          errors.push(`${prefix}: Invalid rate_limit format. Use "N/unit" (e.g., "20/minute")`);
        }
      }
    }

    return errors;
  }
}
