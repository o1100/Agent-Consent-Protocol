/**
 * Cryptographic Operations — Ed25519
 *
 * Key generation, signing, and verification for consent proofs.
 * Uses Node.js built-in crypto (no external dependencies).
 */

import crypto from 'node:crypto';

export interface KeyPair {
  publicKey: string;   // hex-encoded DER
  privateKey: string;  // hex-encoded DER
}

/**
 * Generate a new Ed25519 key pair.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  return {
    publicKey: publicKey.toString('hex'),
    privateKey: privateKey.toString('hex'),
  };
}

/**
 * Load an Ed25519 private key from hex-encoded DER.
 */
export function loadPrivateKey(hexKey: string): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.from(hexKey, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Load an Ed25519 public key from hex-encoded DER.
 */
export function loadPublicKey(hexKey: string): crypto.KeyObject {
  return crypto.createPublicKey({
    key: Buffer.from(hexKey, 'hex'),
    format: 'der',
    type: 'spki',
  });
}

/**
 * SHA-256 hash in "sha256:<hex>" format.
 */
export function sha256(data: string): string {
  return `sha256:${crypto.createHash('sha256').update(data, 'utf8').digest('hex')}`;
}

/**
 * Canonical JSON: sorted keys, no whitespace.
 */
export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Sign data with an Ed25519 private key.
 */
export function sign(data: string, privateKeyHex: string): string {
  const privateKey = loadPrivateKey(privateKeyHex);
  const signature = crypto.sign(null, Buffer.from(data, 'utf8'), privateKey);
  return signature.toString('hex');
}

/**
 * Verify an Ed25519 signature.
 */
export function verify(data: string, signatureHex: string, publicKeyHex: string): boolean {
  const publicKey = loadPublicKey(publicKeyHex);
  return crypto.verify(
    null,
    Buffer.from(data, 'utf8'),
    publicKey,
    Buffer.from(signatureHex, 'hex')
  );
}

/**
 * Generate a cryptographically secure nonce.
 */
export function generateNonce(): string {
  return `n_${crypto.randomUUID()}`;
}

/**
 * Generate a unique consent request ID.
 */
export function generateRequestId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `cr_${ts}${rand}`;
}
