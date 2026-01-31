import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  loadPrivateKey,
  loadPublicKey,
  sign,
  verify,
  sha256,
  canonicalJSON,
  generateNonce,
  generateRequestId,
} from '../crypto/keys.js';

describe('Key generation', () => {
  it('generates a valid Ed25519 key pair', () => {
    const kp = generateKeyPair();
    assert.ok(kp.publicKey.length > 0);
    assert.ok(kp.privateKey.length > 0);
    // Should be hex-encoded
    assert.ok(/^[0-9a-f]+$/.test(kp.publicKey));
    assert.ok(/^[0-9a-f]+$/.test(kp.privateKey));
  });

  it('loads private and public keys without error', () => {
    const kp = generateKeyPair();
    const priv = loadPrivateKey(kp.privateKey);
    const pub = loadPublicKey(kp.publicKey);
    assert.ok(priv);
    assert.ok(pub);
  });
});

describe('Sign and verify', () => {
  it('signs and verifies data', () => {
    const kp = generateKeyPair();
    const data = 'hello world';
    const sig = sign(data, kp.privateKey);
    assert.ok(sig.length > 0);
    assert.strictEqual(verify(data, sig, kp.publicKey), true);
  });

  it('verification fails with wrong data', () => {
    const kp = generateKeyPair();
    const sig = sign('original', kp.privateKey);
    assert.strictEqual(verify('tampered', sig, kp.publicKey), false);
  });

  it('verification fails with wrong key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const sig = sign('data', kp1.privateKey);
    assert.strictEqual(verify('data', sig, kp2.publicKey), false);
  });
});

describe('sha256', () => {
  it('produces sha256:<hex> format', () => {
    const hash = sha256('test');
    assert.ok(hash.startsWith('sha256:'));
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(hash));
  });

  it('same input produces same output', () => {
    assert.strictEqual(sha256('hello'), sha256('hello'));
  });

  it('different input produces different output', () => {
    assert.notStrictEqual(sha256('a'), sha256('b'));
  });
});

describe('canonicalJSON', () => {
  it('sorts keys alphabetically', () => {
    const result = canonicalJSON({ b: 1, a: 2 });
    assert.strictEqual(result, '{"a":2,"b":1}');
  });

  it('sorts nested keys', () => {
    const result = canonicalJSON({ z: { b: 1, a: 2 }, a: 3 });
    assert.strictEqual(result, '{"a":3,"z":{"a":2,"b":1}}');
  });

  it('handles arrays (preserves order)', () => {
    const result = canonicalJSON({ arr: [3, 1, 2] });
    assert.strictEqual(result, '{"arr":[3,1,2]}');
  });

  it('handles null and primitives', () => {
    assert.strictEqual(canonicalJSON(null), 'null');
    assert.strictEqual(canonicalJSON(42), '42');
    assert.strictEqual(canonicalJSON('str'), '"str"');
  });

  it('produces no whitespace', () => {
    const result = canonicalJSON({ a: 1, b: { c: 2 } });
    assert.ok(!result.includes(' '));
    assert.ok(!result.includes('\n'));
  });
});

describe('generateNonce', () => {
  it('starts with n_', () => {
    const nonce = generateNonce();
    assert.ok(nonce.startsWith('n_'));
  });

  it('generates unique values', () => {
    const a = generateNonce();
    const b = generateNonce();
    assert.notStrictEqual(a, b);
  });
});

describe('generateRequestId', () => {
  it('starts with cr_', () => {
    const id = generateRequestId();
    assert.ok(id.startsWith('cr_'));
  });

  it('generates unique values', () => {
    const a = generateRequestId();
    const b = generateRequestId();
    assert.notStrictEqual(a, b);
  });
});
