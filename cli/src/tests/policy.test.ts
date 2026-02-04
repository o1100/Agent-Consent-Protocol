import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicy, globMatch } from '../core/policy.js';
import type { Action } from '../core/types.js';

describe('Policy.evaluate', () => {
  it('uses default action when no rules match', () => {
    const policy = parsePolicy('default: deny\nwrap: []\nrules: []');
    const action: Action = { name: 'unknown', meta: { kind: 'shell' } };
    assert.strictEqual(policy.evaluate(action).action, 'deny');
  });

  it('matches by name exactly', () => {
    const policy = parsePolicy(`
default: ask
wrap: []
rules:
  - match: { name: "cat" }
    action: allow
`);
    assert.strictEqual(
      policy.evaluate({ name: 'cat', meta: { kind: 'shell' } }).action,
      'allow'
    );
    assert.strictEqual(
      policy.evaluate({ name: 'dog', meta: { kind: 'shell' } }).action,
      'ask'
    );
  });

  it('matches name with glob pattern', () => {
    const policy = parsePolicy(`
default: deny
wrap: []
rules:
  - match: { name: "gh", args: "pr list*" }
    action: allow
  - match: { name: "gh" }
    action: ask
`);

    assert.strictEqual(
      policy.evaluate({ name: 'gh', args: 'pr list --state=open', meta: { kind: 'shell' } }).action,
      'allow'
    );
    assert.strictEqual(
      policy.evaluate({ name: 'gh', args: 'commit -m fix', meta: { kind: 'shell' } }).action,
      'ask'
    );
  });

  it('matches HTTP rules by host', () => {
    const policy = parsePolicy(`
default: deny
wrap: []
rules:
  - match: { kind: http, host: "*.anthropic.com" }
    action: allow
  - match: { kind: http, host: "*.evil.com" }
    action: deny
`);

    assert.strictEqual(
      policy.evaluate({
        name: 'http:CONNECT',
        meta: { kind: 'http', host: 'api.anthropic.com' },
      }).action,
      'allow'
    );

    assert.strictEqual(
      policy.evaluate({
        name: 'http:CONNECT',
        meta: { kind: 'http', host: 'www.evil.com' },
      }).action,
      'deny'
    );
  });

  it('matches HTTP rules by method', () => {
    const policy = parsePolicy(`
default: ask
wrap: []
rules:
  - match: { kind: http, host: "api.github.com", method: "GET" }
    action: allow
  - match: { kind: http, host: "api.github.com", method: "POST" }
    action: ask
`);

    assert.strictEqual(
      policy.evaluate({
        name: 'http:GET',
        meta: { kind: 'http', host: 'api.github.com', method: 'GET' },
      }).action,
      'allow'
    );

    assert.strictEqual(
      policy.evaluate({
        name: 'http:POST',
        meta: { kind: 'http', host: 'api.github.com', method: 'POST' },
      }).action,
      'ask'
    );
  });

  it('first matching rule wins', () => {
    const policy = parsePolicy(`
default: ask
wrap: []
rules:
  - match: { name: "rm", args: "-rf /*" }
    action: deny
  - match: { name: "rm" }
    action: ask
`);

    assert.strictEqual(
      policy.evaluate({ name: 'rm', args: '-rf /*', meta: { kind: 'shell' } }).action,
      'deny'
    );
    assert.strictEqual(
      policy.evaluate({ name: 'rm', args: 'temp.txt', meta: { kind: 'shell' } }).action,
      'ask'
    );
  });

  it('rule with no match criteria matches everything', () => {
    const policy = parsePolicy(`
default: deny
wrap: []
rules:
  - action: allow
`);

    assert.strictEqual(
      policy.evaluate({ name: 'anything', meta: { kind: 'shell' } }).action,
      'allow'
    );
  });

  it('kind filter prevents cross-matching', () => {
    const policy = parsePolicy(`
default: deny
wrap: []
rules:
  - match: { kind: http, host: "*.example.com" }
    action: allow
`);

    // Shell action should NOT match HTTP rule
    assert.strictEqual(
      policy.evaluate({ name: 'curl', meta: { kind: 'shell' } }).action,
      'deny'
    );

    // HTTP action should match
    assert.strictEqual(
      policy.evaluate({
        name: 'http:GET',
        meta: { kind: 'http', host: 'api.example.com' },
      }).action,
      'allow'
    );
  });

  it('returns timeout from rule', () => {
    const policy = parsePolicy(`
default: ask
wrap: []
rules:
  - match: { name: "gh", args: "commit*" }
    action: ask
    timeout: 120
`);

    const result = policy.evaluate({
      name: 'gh',
      args: 'commit -m fix',
      meta: { kind: 'shell' },
    });

    assert.strictEqual(result.action, 'ask');
    assert.strictEqual(result.timeout, 120);
  });

  it('exposes wrap list from policy', () => {
    const policy = parsePolicy(`
default: ask
wrap:
  - gh
  - git
  - curl
rules: []
`);

    assert.deepStrictEqual(policy.wrap, ['gh', 'git', 'curl']);
  });

  it('handles missing wrap list', () => {
    const policy = parsePolicy('default: ask\nrules: []');
    assert.deepStrictEqual(policy.wrap, []);
  });
});

describe('globMatch', () => {
  it('matches exact strings', () => {
    assert.strictEqual(globMatch('cat', 'cat'), true);
    assert.strictEqual(globMatch('cat', 'dog'), false);
  });

  it('* matches any characters', () => {
    assert.strictEqual(globMatch('api.anthropic.com', '*.anthropic.com'), true);
    assert.strictEqual(globMatch('anthropic.com', '*.anthropic.com'), false);
    assert.strictEqual(globMatch('pr list --state=open', 'pr list*'), true);
  });

  it('? matches single character', () => {
    assert.strictEqual(globMatch('cat', 'ca?'), true);
    assert.strictEqual(globMatch('cats', 'ca?'), false);
  });

  it('wildcard * matches everything', () => {
    assert.strictEqual(globMatch('anything', '*'), true);
    assert.strictEqual(globMatch('', '*'), true);
  });

  it('escapes regex special characters', () => {
    assert.strictEqual(globMatch('-rf /*', '-rf /*'), true);
    // * matches any characters, so -rf /home matches -rf /*
    assert.strictEqual(globMatch('-rf /home', '-rf /*'), true);
    // Literal dots are escaped
    assert.strictEqual(globMatch('api.example.com', '*.example.com'), true);
    assert.strictEqual(globMatch('apiexampleXcom', '*.example.com'), false);
  });
});
