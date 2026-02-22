import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderEgressRules } from '../vm/nftables.js';

describe('vm nftables rules', () => {
  it('renders fail-closed rules for a user and proxy port', () => {
    const rules = renderEgressRules({
      uid: 1001,
      proxyPort: 8444,
      dnsServers: ['168.63.129.16', '2001:4860:4860::8888'],
      tableName: 'acp_vm_v030_test',
    });

    assert.match(rules, /meta skuid 1001 ip daddr 127\.0\.0\.1 tcp dport 8444/);
    assert.match(rules, /meta skuid 1001 ip6 daddr ::1 tcp dport 8444/);
    assert.match(rules, /meta skuid 1001 ip daddr 168\.63\.129\.16 udp dport 53/);
    assert.match(rules, /meta skuid 1001 ip daddr 168\.63\.129\.16 tcp dport 53/);
    assert.match(rules, /meta skuid 1001 ip6 daddr 2001:4860:4860::8888 udp dport 53/);
    assert.match(rules, /meta skuid 1001 ip protocol tcp .* reject/);
    assert.match(rules, /meta skuid 1001 .* reject with icmpx type admin-prohibited/);
  });

  it('rejects invalid uid', () => {
    assert.throws(() => {
      renderEgressRules({ uid: 0, proxyPort: 8444 });
    }, /UID must be a positive integer/);
  });

  it('rejects invalid port', () => {
    assert.throws(() => {
      renderEgressRules({ uid: 1000, proxyPort: 70000 });
    }, /Proxy port must be between 1 and 65535/);
  });
});
