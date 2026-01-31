/**
 * acp status — Show ACP status and running sessions
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { CredentialVault } from '../sandbox/credentials.js';

const ACP_DIR = path.join(process.env.HOME || '~', '.acp');

export async function statusCommand(): Promise<void> {
  console.log('');
  console.log('  🔐 ACP Status');
  console.log('  ─────────────');

  // Check if initialized
  const configPath = path.join(ACP_DIR, 'config.yml');
  if (!fs.existsSync(configPath)) {
    console.log('  ❌ Not initialized. Run: acp init');
    return;
  }

  const config = yamlParse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`  Config:   ${configPath}`);
  console.log(`  Channel:  ${config.channel || 'prompt'}`);

  // Check keys
  const keysDir = path.join(ACP_DIR, 'keys');
  const privateKeyPath = path.join(keysDir, 'private.key');
  const hasKeys = fs.existsSync(privateKeyPath) &&
                  fs.existsSync(path.join(keysDir, 'public.key'));
  console.log(`  Keys:     ${hasKeys ? '✅ Present' : '❌ Missing'}`);

  // Check policy
  const policyPath = path.join(ACP_DIR, 'policy.yml');
  console.log(`  Policy:   ${fs.existsSync(policyPath) ? '✅ ' + policyPath : '❌ Missing'}`);

  // Check vault — use CredentialVault to handle encrypted vaults
  const vaultPath = path.join(ACP_DIR, 'vault.json');
  if (fs.existsSync(vaultPath)) {
    try {
      // Pass private key path so vault can decrypt
      const vault = new CredentialVault(vaultPath, hasKeys ? privateKeyPath : undefined);
      const secretCount = vault.list().length;
      const vaultData = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
      const encrypted = vaultData.version === 2;
      console.log(`  Vault:    ✅ ${secretCount} secret(s)${encrypted ? ' (encrypted)' : ' (plaintext)'}`);
    } catch {
      console.log('  Vault:    ⚠️  Could not read vault');
    }
  } else {
    console.log('  Vault:    ❌ Missing');
  }

  // Check audit log
  const auditPath = path.join(ACP_DIR, 'audit.jsonl');
  if (fs.existsSync(auditPath)) {
    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n').filter(Boolean);
    console.log(`  Audit:    ✅ ${lines.length} event(s)`);
  } else {
    console.log('  Audit:    No events yet');
  }

  console.log('');
}
