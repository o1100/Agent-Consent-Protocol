import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeOptions, parsePositivePort } from '../cli/start-utils.js';

describe('start utils', () => {
  it('parses valid port boundaries', () => {
    assert.strictEqual(parsePositivePort('1', 'http-proxy-port'), 1);
    assert.strictEqual(parsePositivePort('65535', 'http-proxy-port'), 65535);
  });

  it('rejects invalid ports', () => {
    assert.throws(() => parsePositivePort('0', 'http-proxy-port'), /Expected 1-65535/);
    assert.throws(() => parsePositivePort('70000', 'http-proxy-port'), /Expected 1-65535/);
    assert.throws(() => parsePositivePort('abc', 'http-proxy-port'), /Expected 1-65535/);
  });

  it('appends required modules and dns ordering option', () => {
    const options = buildNodeOptions('', ['global-agent/bootstrap', '/tmp/acp-proxy-bootstrap.cjs']);
    assert.match(options, /--require global-agent\/bootstrap/);
    assert.match(options, /--require \/tmp\/acp-proxy-bootstrap\.cjs/);
    assert.match(options, /--dns-result-order=ipv4first/);
  });

  it('avoids duplicate require and dns options', () => {
    const existing = '--require global-agent/bootstrap --dns-result-order=ipv4first';
    const options = buildNodeOptions(existing, ['global-agent/bootstrap']);
    assert.strictEqual(options, existing);
  });

  it('preserves existing node options and appends missing pieces', () => {
    const options = buildNodeOptions(' --max-old-space-size=4096 ', ['/tmp/acp-proxy-bootstrap.cjs']);
    assert.match(options, /^--max-old-space-size=4096 /);
    assert.match(options, /--require \/tmp\/acp-proxy-bootstrap\.cjs/);
    assert.match(options, /--dns-result-order=ipv4first/);
  });
});
