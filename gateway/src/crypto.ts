/**
 * ACP Gateway — Cryptographic Operations
 *
 * Ed25519 signing and verification for consent proofs.
 * Uses Node.js built-in crypto module (no external dependencies).
 */

import crypto from 'node:crypto';
import type { ConsentProof, ConsentRequest, ConsentResponse } from './types.js';

// ─── Key Management ─────────────────────────────────────────────────

export interface KeyPair {
  publicKey: string;   // hex-encoded
  privateKey: string;  // hex-encoded
}

/**
 * Generate a new Ed25519 key pair for signing consent proofs.
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
 * Load an Ed25519 private key from hex-encoded DER format.
 */
export function loadPrivateKey(hexKey: string): crypto.KeyObject {
  const keyBuffer = Buffer.from(hexKey, 'hex');
  return crypto.createPrivateKey({
    key: keyBuffer,
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Load an Ed25519 public key from hex-encoded DER format.
 */
export function loadPublicKey(hexKey: string): crypto.KeyObject {
  const keyBuffer = Buffer.from(hexKey, 'hex');
  return crypto.createPublicKey({
    key: keyBuffer,
    format: 'der',
    type: 'spki',
  });
}

// ─── Hashing ────────────────────────────────────────────────────────

/**
 * SHA-256 hash of a string, returned as "sha256:<hex>" format.
 */
export function sha256(data: string): string {
  const hash = crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Create a canonical JSON string for deterministic hashing.
 * Keys are sorted, no extra whitespace.
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort(), 0)
    .replace(/\s+/g, '');
}

/**
 * Properly sort keys recursively for canonical JSON.
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

/**
 * Create canonical JSON with recursively sorted keys.
 */
export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

// ─── Consent Proof Creation ─────────────────────────────────────────

export interface SigningPayload {
  request_id: string;
  decision: string;
  nonce: string;
  timestamp: string;
  action_hash: string;
  modifications_hash: string | null;
  valid_until: string;
}

/**
 * Create a signed consent proof.
 *
 * The proof binds the approval decision to the specific request,
 * action parameters, nonce, and expiration time. This prevents
 * forgery, replay, and parameter manipulation.
 */
export function createConsentProof(
  privateKeyHex: string,
  requestId: string,
  decision: string,
  nonce: string,
  timestamp: string,
  actionParams: Record<string, unknown>,
  modifications: Record<string, unknown> | null | undefined,
  validUntil: string
): ConsentProof {
  const privateKey = loadPrivateKey(privateKeyHex);

  // Hash the action parameters
  const actionHash = sha256(canonicalJSON(actionParams));

  // Hash modifications if present
  const modificationsHash = modifications
    ? sha256(canonicalJSON(modifications))
    : null;

  // Build the signing payload
  const payload: SigningPayload = {
    request_id: requestId,
    decision,
    nonce,
    timestamp,
    action_hash: actionHash,
    modifications_hash: modificationsHash,
    valid_until: validUntil,
  };

  const canonical = canonicalJSON(payload);
  const payloadHash = sha256(canonical);

  // Sign the canonical payload
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);

  // Extract public key from private key
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  return {
    algorithm: 'Ed25519',
    public_key: (publicKeyDer as Buffer).toString('hex'),
    signature: signature.toString('hex'),
    signed_payload_hash: payloadHash,
  };
}

// ─── Consent Proof Verification ─────────────────────────────────────

export interface VerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify a consent proof is authentic and valid.
 *
 * Checks:
 * 1. Public key is in the trusted set
 * 2. Payload hash matches reconstructed hash
 * 3. Ed25519 signature is valid
 * 4. Nonce matches original request
 * 5. Consent hasn't expired
 */
export function verifyConsentProof(
  proof: ConsentProof,
  response: ConsentResponse,
  originalRequest: ConsentRequest,
  trustedPublicKeys: string[]
): VerificationResult {
  // 1. Check public key is trusted
  if (!trustedPublicKeys.includes(proof.public_key)) {
    return { valid: false, error: 'Unknown or untrusted public key' };
  }

  // 2. Reconstruct the signing payload
  const actionHash = sha256(canonicalJSON(originalRequest.action.parameters));
  const modificationsHash = response.modifications
    ? sha256(canonicalJSON(response.modifications))
    : null;

  const payload: SigningPayload = {
    request_id: response.request_id,
    decision: response.decision,
    nonce: response.nonce,
    timestamp: response.timestamp,
    action_hash: actionHash,
    modifications_hash: modificationsHash,
    valid_until: response.conditions.valid_until,
  };

  const canonical = canonicalJSON(payload);
  const expectedHash = sha256(canonical);

  // 3. Verify payload hash
  if (proof.signed_payload_hash !== expectedHash) {
    return { valid: false, error: 'Payload hash mismatch — data may have been tampered with' };
  }

  // 4. Verify Ed25519 signature
  try {
    const publicKey = loadPublicKey(proof.public_key);
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

  // 5. Check nonce matches
  if (response.nonce !== originalRequest.nonce) {
    return { valid: false, error: 'Nonce mismatch — possible replay attack' };
  }

  // 6. Check expiration
  const validUntil = new Date(response.conditions.valid_until);
  if (validUntil < new Date()) {
    return { valid: false, error: 'Consent proof has expired' };
  }

  return { valid: true };
}

// ─── Nonce Generation ───────────────────────────────────────────────

/**
 * Generate a cryptographically secure nonce for replay prevention.
 */
export function generateNonce(): string {
  return `n_${crypto.randomUUID()}`;
}

/**
 * Generate a unique consent request ID.
 */
export function generateRequestId(): string {
  // Use a timestamp prefix + random suffix for sortability
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `cr_${timestamp}${random}`;
}
