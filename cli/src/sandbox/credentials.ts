/**
 * Credential Vault
 *
 * Encrypted storage for API keys, tokens, and other secrets.
 * Secrets are stored in ~/.acp/vault.json and never exposed
 * to the agent process.
 *
 * For the MVP, secrets are stored as plaintext JSON with file
 * permissions (0600). Full AES-256-GCM encryption will use the
 * Ed25519 private key as the encryption key source (via HKDF).
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

interface VaultData {
  version: number;
  secrets: Record<string, string>;
}

export class CredentialVault {
  private vaultPath: string;
  private data: VaultData;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.data = this.load();
  }

  /**
   * Load vault from disk.
   */
  private load(): VaultData {
    if (!fs.existsSync(this.vaultPath)) {
      return { version: 1, secrets: {} };
    }

    try {
      const content = fs.readFileSync(this.vaultPath, 'utf-8');
      return JSON.parse(content) as VaultData;
    } catch {
      console.warn('  ⚠️  Vault file corrupted. Starting fresh.');
      return { version: 1, secrets: {} };
    }
  }

  /**
   * Save vault to disk with restricted permissions.
   */
  private save(): void {
    const content = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(this.vaultPath, content, { mode: 0o600 });
  }

  /**
   * Store a secret in the vault.
   */
  set(key: string, value: string): void {
    this.data.secrets[key] = value;
    this.save();
  }

  /**
   * Retrieve a secret from the vault.
   */
  get(key: string): string | undefined {
    return this.data.secrets[key];
  }

  /**
   * Remove a secret from the vault.
   */
  remove(key: string): boolean {
    if (key in this.data.secrets) {
      delete this.data.secrets[key];
      this.save();
      return true;
    }
    return false;
  }

  /**
   * List all secret keys (not values).
   */
  list(): string[] {
    return Object.keys(this.data.secrets);
  }

  /**
   * Check if a secret exists.
   */
  has(key: string): boolean {
    return key in this.data.secrets;
  }

  /**
   * Get a map of all secrets (for credential injection).
   * Use with caution — only called internally by the consent gate.
   */
  getAll(): Record<string, string> {
    return { ...this.data.secrets };
  }

  /**
   * Generate a random encryption key for future AES-256-GCM encryption.
   * This will be derived from the Ed25519 private key via HKDF.
   */
  static generateEncryptionKey(): Buffer {
    return crypto.randomBytes(32);
  }
}
