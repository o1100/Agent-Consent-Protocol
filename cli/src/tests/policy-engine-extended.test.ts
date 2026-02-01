import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine, type Policy } from '../policy/engine.js';

describe('PolicyEngine extended classifications', () => {
  const engine = new PolicyEngine({ version: '2', default_action: 'ask', rules: [] });

  it('classifies shell commands', () => {
    assert.deepStrictEqual(engine.classify('shell:curl'), { category: 'network', riskLevel: 'medium' });
    assert.deepStrictEqual(engine.classify('shell:ssh'), { category: 'network', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('shell:rm'), { category: 'filesystem', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('shell:git'), { category: 'system', riskLevel: 'medium' });
    assert.deepStrictEqual(engine.classify('shell:docker'), { category: 'system', riskLevel: 'critical' });
    assert.deepStrictEqual(engine.classify('shell:python3'), { category: 'system', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('shell:npm'), { category: 'system', riskLevel: 'medium' });
  });

  it('classifies HTTP methods', () => {
    assert.deepStrictEqual(engine.classify('http:GET'), { category: 'network', riskLevel: 'low' });
    assert.deepStrictEqual(engine.classify('http:POST'), { category: 'network', riskLevel: 'medium' });
    assert.deepStrictEqual(engine.classify('http:DELETE'), { category: 'network', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('http:CONNECT'), { category: 'network', riskLevel: 'medium' });
  });

  it('classifies file operations', () => {
    assert.deepStrictEqual(engine.classify('file:read'), { category: 'filesystem', riskLevel: 'low' });
    assert.deepStrictEqual(engine.classify('file:write'), { category: 'filesystem', riskLevel: 'medium' });
    assert.deepStrictEqual(engine.classify('file:rm'), { category: 'filesystem', riskLevel: 'high' });
  });

  it('still classifies MCP tools correctly', () => {
    assert.deepStrictEqual(engine.classify('web_search'), { category: 'read', riskLevel: 'low' });
    assert.deepStrictEqual(engine.classify('send_email'), { category: 'communication', riskLevel: 'high' });
    assert.deepStrictEqual(engine.classify('transfer_money'), { category: 'financial', riskLevel: 'critical' });
  });
});

describe('PolicyEngine kind matching', () => {
  it('matches rules by kind', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { kind: 'shell' }, action: 'ask', level: 'high' },
        { match: { kind: 'http' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('shell:curl', {}, 'shell').action, 'ask');
    assert.strictEqual(engine.evaluate('http:GET', {}, 'http').action, 'allow');
    // Without kind, shell rule should not match
    assert.strictEqual(engine.evaluate('shell:curl', {}).action, 'deny');
  });

  it('matches kind + tool together', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { kind: 'shell', tool: 'shell:git' }, action: 'allow' },
        { match: { kind: 'shell' }, action: 'ask' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('shell:git', {}, 'shell').action, 'allow');
    assert.strictEqual(engine.evaluate('shell:rm', {}, 'shell').action, 'ask');
  });
});

describe('PolicyEngine host matching', () => {
  it('matches HTTP rules by host glob', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { kind: 'http', host: '*.googleapis.com' }, action: 'allow' },
        { match: { kind: 'http', host: '*.stripe.com' }, action: 'ask', level: 'critical' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(
      engine.evaluate('http:GET', { host: 'api.googleapis.com' }, 'http').action,
      'allow'
    );
    assert.strictEqual(
      engine.evaluate('http:POST', { host: 'api.stripe.com' }, 'http').action,
      'ask'
    );
    assert.strictEqual(
      engine.evaluate('http:GET', { host: 'evil.com' }, 'http').action,
      'deny'
    );
  });
});

describe('PolicyEngine path matching', () => {
  it('matches file rules by path glob', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { kind: 'file', path: '~/workspace/**' }, action: 'allow' },
        { match: { kind: 'file', tool: 'file:rm' }, action: 'ask', level: 'high' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(
      engine.evaluate('file:write', { path: '~/workspace/src/main.ts' }, 'file').action,
      'allow'
    );
    assert.strictEqual(
      engine.evaluate('file:rm', { path: '/etc/passwd' }, 'file').action,
      'ask'
    );
  });

  it('** matches nested paths', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { path: '/home/user/projects/**' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(
      engine.evaluate('file:write', { path: '/home/user/projects/foo/bar/baz.ts' }).action,
      'allow'
    );
    assert.strictEqual(
      engine.evaluate('file:write', { path: '/home/user/secret.txt' }).action,
      'deny'
    );
  });
});

describe('PolicyEngine command matching', () => {
  it('matches shell rules by command glob', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { kind: 'shell', tool: 'shell:git', command: 'git push *' }, action: 'ask', level: 'high' },
        { match: { kind: 'shell', tool: 'shell:git', command: 'git status*' }, action: 'allow' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(
      engine.evaluate('shell:git', { command: 'git push origin main' }, 'shell').action,
      'ask'
    );
    assert.strictEqual(
      engine.evaluate('shell:git', { command: 'git status' }, 'shell').action,
      'allow'
    );
  });
});

describe('PolicyEngine network/filesystem categories', () => {
  it('matches network category for shell network tools', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { category: 'network' }, action: 'ask' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('shell:curl', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('http:GET', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('shell:rm', {}).action, 'deny'); // filesystem, not network
  });

  it('matches filesystem category', () => {
    const policy: Policy = {
      version: '2',
      default_action: 'deny',
      rules: [
        { match: { category: 'filesystem' }, action: 'ask' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('shell:rm', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('file:write', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('shell:curl', {}).action, 'deny'); // network, not filesystem
  });
});

describe('PolicyEngine backwards compatibility', () => {
  it('v1 policies still work with v2 engine', () => {
    const policy: Policy = {
      version: '1',
      default_action: 'ask',
      rules: [
        { match: { category: 'read' }, action: 'allow' },
        { match: { tool: 'exec' }, action: 'ask', level: 'high' },
        { match: { category: 'financial' }, action: 'ask', level: 'critical' },
      ],
    };
    const engine = new PolicyEngine(policy);

    assert.strictEqual(engine.evaluate('web_search', {}).action, 'allow');
    assert.strictEqual(engine.evaluate('exec', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('transfer_money', {}).action, 'ask');
    assert.strictEqual(engine.evaluate('random_tool', {}).action, 'ask');
  });
});
