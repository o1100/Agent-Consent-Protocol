import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generateProxyBootstrapCode } from '../cli/start.js';

describe('generateProxyBootstrapCode', () => {
  const code = generateProxyBootstrapCode();

  it('produces valid JavaScript (no SyntaxError)', () => {
    assert.doesNotThrow(() => {
      new vm.Script(code, { filename: 'acp-proxy-bootstrap.cjs' });
    });
  });

  it('references all 4 layers', () => {
    assert.match(code, /Layer 1/);
    assert.match(code, /Layer 2/);
    assert.match(code, /Layer 3/);
    assert.match(code, /Layer 4/);
  });

  it('reads proxy URL from env vars, not hardcoded', () => {
    assert.match(code, /process\.env\.HTTPS_PROXY/);
    assert.match(code, /process\.env\.HTTP_PROXY/);
    // Should not contain a hardcoded proxy address
    assert.doesNotMatch(code, /http:\/\/127\.0\.0\.1:\d{4,5}/);
  });

  it('patches both https.request and https.get', () => {
    assert.match(code, /https\.request\s*=/);
    assert.match(code, /https\.get\s*=/);
  });
});
