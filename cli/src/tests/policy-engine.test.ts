import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine, type Policy } from '../policy/engine.js';

describe('PolicyEngine.classify', () => {
  const engine = new PolicyEngine({ version: '1', default_action: 'ask', rules: [] });

  it('classifies exact-match tools', () => {
    assert.deepStrictEqual(engine.classify('web_search'), { category: 'read', riskLevel: 'low' });
    assert.deepStrictEqual(engine.classify('send_email'), { category: 'communication', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('transfer_money'), { category: 'financial', riskLevel: 'critical' });
  });

  it('classifies by pattern', () => {
    assert.deepStrictEqual(engine.classify('read_database'), { category: 'read', riskLevel: 'low' });
    assert.deepStrictEqual(engine.classify('write_config'), { category: 'write', riskLevel: 'medium' });
    assert.deepStrictEqual(engine.classify('delete_records'), { category: 'system', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('deploy_staging'), { category: 'system', riskLevel: 'high' });
  });

  it('returns unknown/medium for unrecognized tools', () => {
    assert.deepStrictEqual(engine.classify('some_random_tool'), { category: 'unknown', riskLevel: 'medium' });
  });
});

describe('PolicyEngine.evaluate', () => {
  it('uses default_action when no rules match', () => {
    const engine = new PolicyEngine({ version: '1', default_action: 'deny', rules: [] });
    const result = engine.evaluate('unknown_tool', {});
    assert.strictEqual(result.action, 'deny');
  });

  it('matches tool name exactly', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'ask',
      rules: [
        { match: { tool: 'web_search' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);
    assert.strictEqual(engine.evaluate('web_search', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('other_tool', {}).action, 'ask');
  });

  it('matches tool name with glob', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'deny',
      rules: [
        { match: { tool: 'read_*' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);
    assert.strictEqual(engine.evaluate('read_file', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('read_db', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('write_file', {}).action, 'deny');
  });

  it('matches by category', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'deny',
      rules: [
        { match: { category: 'read' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);
    assert.strictEqual(engine.evaluate('web_search', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('send_email', {}).action, 'deny');
  });

  it('matches by args', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'deny',
      rules: [
        { match: { tool: 'send_email', args: { to: '*@company.com' } }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);
    assert.strictEqual(engine.evaluate('send_email', { to: 'alice@company.com' }).action, 'allow');
    assert.strictEqual(engine.evaluate('send_email', { to: 'alice@evil.com' }).action, 'deny');
  });

  it('first matching rule wins', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'ask',
      rules: [
        { match: { tool: 'web_search' }, action: 'deny' },
        { match: { tool: 'web_search' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);
    assert.strictEqual(engine.evaluate('web_search', {}).action, 'deny');
  });

  it('rule with no match criteria matches everything', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'deny',
      rules: [
        { action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);
    assert.strictEqual(engine.evaluate('anything', {}).action, 'allow');
  });
});

describe('PolicyEngine glob matching', () => {
  const policy: Policy = {
    version: '1',
    default_action: 'deny',
    rules: [
      { match: { tool: 'file_*' }, action: 'allow' },
      { match: { tool: 'db_query_?' }, action: 'ask' },
    ],
  };
  const engine = new PolicyEngine(policy);

  it('* matches any characters', () => {
    assert.strictEqual(engine.evaluate('file_read', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('file_write_all', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('file_', {}).action, 'allow');
  });

  it('? matches single character', () => {
    assert.strictEqual(engine.evaluate('db_query_1', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('db_query_ab', {}).action, 'deny');
  });
});

describe('PolicyEngine rate limiting', () => {
  it('denies when rate limit is exceeded', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'allow',
      rules: [
        { match: { tool: '*' }, action: 'allow', rate_limit: '3/minute' },
      ],
    };
    const engine = new PolicyEngine(policy);

    // First 3 calls should be allowed
    assert.strictEqual(engine.evaluate('web_search', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('web_search', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('web_search', {}).action, 'allow');

    // 4th call should be denied
    const result = engine.evaluate('web_search', {});
    assert.strictEqual(result.action, 'deny');
    assert.ok(result.reason?.includes('Rate limit exceeded'));
  });

  it('rate limits are per-tool', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'allow',
      rules: [
        { match: { tool: '*' }, action: 'allow', rate_limit: '2/minute' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('tool_a', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('tool_a', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('tool_a', {}).action, 'deny');

    // Different tool should still be allowed
    assert.strictEqual(engine.evaluate('tool_b', {}).action, 'allow');
  });

  it('rate-limit-only rules (no action) still enforce limits', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'allow',
      rules: [
        { match: { tool: 'fast_tool' }, rate_limit: '1/minute' } as unknown as import('../policy/engine.js').PolicyRule,
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('fast_tool', {}).action, 'allow');
    const result = engine.evaluate('fast_tool', {});
    assert.strictEqual(result.action, 'deny');
    assert.ok(result.reason?.includes('Rate limit exceeded'));
  });
});
