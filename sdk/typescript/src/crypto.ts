/**
 * ACP TypeScript SDK — Cryptographic Operations
 *
 * Consent proof verification using Node.js built-in crypto module.
 */

import crypto from 'node:crypto';
import type { ConsentProof, ConsentResponse } from './types.js';

/**
 * Create a canonical JSON string with recursively sorted keys.
 */
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

export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

/**
 * SHA-256 hash returned as "sha256:<hex>".
 */
export function sha256(data: string): string {
  const hash = crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Verify a consent proof is authentic and valid.
 */
export function verifyConsentProof(
  proof: ConsentProof,
  response: ConsentResponse,
  originalActionParameters: Record<string, unknown>,
  trustedPublicKeys: string[]
): { valid: boolean; error?: string } {
  // 1. Check trusted key
  if (!trustedPublicKeys.includes(proof.public_key)) {
    return { valid: false, error: 'Unknown or untrusted public key' };
  }

  // 2. Reconstruct payload
  const actionHash = sha256(canonicalJSON(originalActionParameters));
  const modificationsHash = response.modifications
    ? sha256(canonicalJSON(response.modifications))
    : null;

  const payload = {
    action_hash: actionHash,
    decision: response.decision,
    modifications_hash: modificationsHash,
    nonce: response.nonce,
    request_id: response.request_id,
    timestamp: response.timestamp,
    valid_until: response.conditions.valid_until,
  };

  const canonical = canonicalJSON(payload);
  const expectedHash = sha256(canonical);

  // 3. Verify hash
  if (proof.signed_payload_hash !== expectedHash) {
    return { valid: false, error: 'Payload hash mismatch' };
  }

  // 4. Verify Ed25519 signature
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(proof.public_key, 'hex'),
      format: 'der',
      type: 'spki',
    });

    const isValid = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKey,
      Buffer.from(proof.signature, 'hex')
    );

    if (!isValid) {
      return { valid: false, error: 'Invalid Ed25519 signature' };
    }
  } catch (err) {
    return { valid: false, error: `Signature verification failed: ${(err as Error).message}` };
  }

  // 5. Check expiration
  if (new Date(response.conditions.valid_until) < new Date()) {
    return { valid: false, error: 'Consent proof has expired' };
  }

  return { valid: true };
}
