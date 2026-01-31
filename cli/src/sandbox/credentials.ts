/**
 * Credential Vault
 *
 * Encrypted storage for API keys, tokens, and other secrets.
 * Secrets are stored in ~/.acp/vault.json, encrypted with
 * AES-256-GCM using a key derived from the Ed25519 private key via HKDF.
 *
 * Vault format v2:
 * {
 *   version: 2,
 *   encryption: "aes-256-gcm",
 *   salt: hex,
 *   iv: hex,
 *   data: encrypted_hex,
 *   tag: hex
 * }
 *
 * Backward compatible: v1 plaintext JSON is auto-migrated on first load.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

interface VaultDataV1 {
  version: 1;
  secrets: Record<string, string>;
}

interface VaultDataEncrypted {
  version: 2;
  encryption: 'aes-256-gcm';
  salt: string;
  iv: string;
  data: string;
  tag: string;
}

type VaultFile = VaultDataV1 | VaultDataEncrypted;

export class CredentialVault {
  private vaultPath: string;
  private secrets: Record<string, string>;
  private encryptionKey: Buffer | null = null;

  constructor(vaultPath: string, privateKeyPath?: string) {
    this.vaultPath = vaultPath;
    this.secrets = {};
    this.loadEncryptionKey(privateKeyPath);
    this.secrets = this.load();
  }

  /**
   * Load the Ed25519 private key and derive an AES-256 encryption key via HKDF.
   */
  private loadEncryptionKey(privateKeyPath?: string): void {
    const keyPath = privateKeyPath ?? path.join(os.homedir(), '.acp', 'keys', 'private.key');
    try {
      if (fs.existsSync(keyPath)) {
        const keyHex = fs.readFileSync(keyPath, 'utf-8').trim();
        const keyBytes = Buffer.from(keyHex, 'hex');
        // Derive AES-256 key from Ed25519 private key using HKDF
        const derived = crypto.hkdfSync(
          'sha256',
          keyBytes,
          Buffer.from('acp-vault-salt', 'utf-8'),
          Buffer.from('acp-credential-vault-v2', 'utf-8'),
          32
        );
        this.encryptionKey = Buffer.from(derived);
      }
    } catch {
      // No encryption key available — will fall back to plaintext
    }
  }

  /**
   * Encrypt plaintext JSON using AES-256-GCM.
   */
  private encrypt(plaintext: string): VaultDataEncrypted {
    if (!this.encryptionKey) {
      throw new Error('No encryption key available');
    }
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      version: 2,
      encryption: 'aes-256-gcm',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      data: encrypted.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  /**
   * Decrypt an encrypted vault.
   */
  private decrypt(vault: VaultDataEncrypted): Record<string, string> {
    if (!this.encryptionKey) {
      throw new Error('No encryption key available to decrypt vault');
    }
    const iv = Buffer.from(vault.iv, 'hex');
    const data = Buffer.from(vault.data, 'hex');
    const tag = Buffer.from(vault.tag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as Record<string, string>;
  }

  /**
   * Load vault from disk.
   * Handles both v1 (plaintext) and v2 (encrypted) formats.
   * Auto-migrates v1 to v2 if encryption key is available.
   */
  private load(): Record<string, string> {
    if (!fs.existsSync(this.vaultPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.vaultPath, 'utf-8');
      const parsed = JSON.parse(content) as VaultFile;

      if (parsed.version === 2 && 'encryption' in parsed) {
        // Encrypted vault v2
        return this.decrypt(parsed as VaultDataEncrypted);
      }

      // V1 plaintext vault — migrate if we have an encryption key
      const v1 = parsed as VaultDataV1;
      const secrets = v1.secrets || {};

      if (this.encryptionKey) {
        // Migrate to encrypted format
        this.secrets = secrets;
        this.save();
        console.log('  🔒 Vault migrated from plaintext to AES-256-GCM encryption.');
      }

      return secrets;
    } catch {
      console.warn('  ⚠️  Vault file corrupted or cannot be decrypted. Starting fresh.');
      return {};
    }
  }

  /**
   * Save vault to disk.
   * Uses AES-256-GCM encryption if key is available, otherwise plaintext v1.
   */
  private save(): void {
    let content: string;

    if (this.encryptionKey) {
      const plaintext = JSON.stringify(this.secrets);
      const encrypted = this.encrypt(plaintext);
      content = JSON.stringify(encrypted, null, 2);
    } else {
      const v1: VaultDataV1 = { version: 1, secrets: this.secrets };
      content = JSON.stringify(v1, null, 2);
    }

    fs.writeFileSync(this.vaultPath, content, { mode: 0o600 });
  }

  /**
   * Store a secret in the vault.
   */
  set(key: string, value: string): void {
    this.secrets[key] = value;
    this.save();
  }

  /**
   * Retrieve a secret from the vault.
   */
  get(key: string): string | undefined {
    return this.secrets[key];
  }

  /**
   * Remove a secret from the vault.
   */
  remove(key: string): boolean {
    if (key in this.secrets) {
      delete this.secrets[key];
      this.save();
      return true;
    }
    return false;
  }

  /**
   * List all secret keys (not values).
   */
  list(): string[] {
    return Object.keys(this.secrets);
  }

  /**
   * Check if a secret exists.
   */
  has(key: string): boolean {
    return key in this.secrets;
  }

  /**
   * Get a map of all secrets (for credential injection).
   * Use with caution — only called internally by the consent gate.
   */
  getAll(): Record<string, string> {
    return { ...this.secrets };
  }

  /**
   * Generate a random encryption key for future AES-256-GCM encryption.
   * This will be derived from the Ed25519 private key via HKDF.
   */
  static generateEncryptionKey(): Buffer {
    return crypto.randomBytes(32);
  }
}
