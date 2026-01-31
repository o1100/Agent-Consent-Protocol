/**
 * ACP Gateway — Policy Engine Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PolicyEngine } from '../src/policy-engine.js';
import type { ActionInfo, AgentInfo, Policy } from '../src/types.js';

const testPolicy: Policy = {
  type: 'policy',
  version: '0.1.0',
  id: 'test_policy',
  name: 'Test Policy',
  rules: [
    {
      id: 'rule_auto_reads',
      name: 'Auto-approve read operations',
      match: { risk_level: ['low'], category: ['data'] },
      action_pattern: 'read_*',
      decision: 'auto_approve',
      priority: 10,
    },
    {
      id: 'rule_block_dangerous',
      name: 'Block dangerous commands',
      match: { category: ['system'] },
      decision: 'always_ask',
      priority: 80,
      constraints: {
        blocked_patterns: ['rm -rf', 'DROP TABLE'],
      },
    },
    {
      id: 'rule_financial',
      name: 'Always ask for financial',
      match: { category: ['financial'] },
      decision: 'always_ask',
      priority: 100,
    },
    {
      id: 'rule_critical',
      name: 'Critical actions need approval',
      match: { risk_level: ['critical'] },
      decision: 'always_ask',
      priority: 200,
    },
    {
      id: 'rule_never_delete_db',
      name: 'Never allow database deletion',
      action_pattern: 'delete_database',
      decision: 'never_allow',
      priority: 300,
    },
  ],
  defaults: {
    unmatched_action: 'always_ask',
    timeout_seconds: 900,
  },
};

const testAgent: AgentInfo = {
  id: 'test_agent',
  name: 'Test Agent',
};

describe('PolicyEngine', () => {
  const engine = new PolicyEngine(testPolicy);

  it('should auto-approve low-risk read operations', () => {
    const action: ActionInfo = {
      tool: 'read_file',
      category: 'data',
      risk_level: 'low',
      parameters: { path: '/tmp/test.txt' },
      description: 'Read a file',
    };

    const result = engine.evaluate(action, testAgent);
    assert.strictEqual(result.action, 'auto_approve');
    assert.strictEqual(result.rule_id, 'rule_auto_reads');
  });

  it('should always ask for financial actions', () => {
    const action: ActionInfo = {
      tool: 'transfer_money',
      category: 'financial',
      risk_level: 'high',
      parameters: { amount: 500, currency: 'USD' },
      description: 'Transfer money',
    };

    const result = engine.evaluate(action, testAgent);
    assert.strictEqual(result.action, 'always_ask');
    assert.strictEqual(result.rule_id, 'rule_financial');
  });

  it('should never allow database deletion', () => {
    const action: ActionInfo = {
      tool: 'delete_database',
      category: 'data',
      risk_level: 'critical',
      parameters: { database: 'production' },
      description: 'Delete production database',
    };

    const result = engine.evaluate(action, testAgent);
    assert.strictEqual(result.action, 'never_allow');
    assert.strictEqual(result.rule_id, 'rule_never_delete_db');
  });

  it('should block actions with dangerous patterns', () => {
    const action: ActionInfo = {
      tool: 'execute_shell',
      category: 'system',
      risk_level: 'high',
      parameters: { command: 'rm -rf /important/data' },
      description: 'Execute shell command',
    };

    const result = engine.evaluate(action, testAgent);
    assert.strictEqual(result.action, 'never_allow');
    assert.ok(result.reason.includes('blocked pattern'));
  });

  it('should use default for unmatched actions', () => {
    const action: ActionInfo = {
      tool: 'some_unknown_tool',
      category: 'identity',
      risk_level: 'medium',
      parameters: {},
      description: 'Unknown action',
    };

    const result = engine.evaluate(action, testAgent);
    assert.strictEqual(result.action, 'always_ask');
    assert.ok(result.reason.includes('default'));
  });

  it('should classify unknown tools using defaults', () => {
    const classification = engine.classifyAction('send_email');
    assert.strictEqual(classification.category, 'communication');
    assert.strictEqual(classification.risk_level, 'high');
  });

  it('should use provided classification over defaults', () => {
    const classification = engine.classifyAction('send_email', 'public', 'critical');
    assert.strictEqual(classification.category, 'public');
    assert.strictEqual(classification.risk_level, 'critical');
  });

  it('should handle wildcard action patterns', () => {
    const action: ActionInfo = {
      tool: 'read_config',
      category: 'data',
      risk_level: 'low',
      parameters: {},
      description: 'Read config',
    };

    const result = engine.evaluate(action, testAgent);
    assert.strictEqual(result.action, 'auto_approve');
  });

  it('should evaluate higher priority rules first', () => {
    // critical risk_level matches both rule_critical (200) and rule_financial (100) if financial
    const action: ActionInfo = {
      tool: 'transfer_money',
      category: 'financial',
      risk_level: 'critical',
      parameters: { amount: 100000 },
      description: 'Large transfer',
    };

    const result = engine.evaluate(action, testAgent);
    // rule_critical has higher priority (200) than rule_financial (100)
    assert.strictEqual(result.rule_id, 'rule_critical');
  });

  it('should return the current policy', () => {
    const policy = engine.getPolicy();
    assert.strictEqual(policy.id, 'test_policy');
    assert.strictEqual(policy.rules.length, 5);
  });
});
