/**
 * acp secret — Manage the encrypted credential vault
 *
 * Commands:
 *   acp secret set KEY=VALUE   Store a secret
 *   acp secret list             List secret keys (values hidden)
 *   acp secret remove KEY       Remove a secret
 */

import path from 'node:path';
import { CredentialVault } from '../sandbox/credentials.js';

const VAULT_PATH = path.join(process.env.HOME || '~', '.acp', 'vault.json');

export async function secretCommand(action: string, arg?: string): Promise<void> {
  const vault = new CredentialVault(VAULT_PATH);

  switch (action) {
    case 'set': {
      if (!arg || !arg.includes('=')) {
        console.error('  ❌ Usage: acp secret set KEY=VALUE');
        process.exit(1);
      }
      const eqIndex = arg.indexOf('=');
      const key = arg.substring(0, eqIndex);
      const value = arg.substring(eqIndex + 1);

      if (!key || !value) {
        console.error('  ❌ Both key and value are required.');
        process.exit(1);
      }

      vault.set(key, value);
      console.log(`  ✅ Secret "${key}" stored.`);
      break;
    }

    case 'list': {
      const keys = vault.list();
      if (keys.length === 0) {
        console.log('  No secrets stored. Use: acp secret set KEY=VALUE');
      } else {
        console.log('');
        console.log('  Stored secrets:');
        for (const key of keys) {
          console.log(`    ${key.padEnd(30)} ••••••••`);
        }
        console.log('');
      }
      break;
    }

    case 'remove': {
      if (!arg) {
        console.error('  ❌ Usage: acp secret remove KEY');
        process.exit(1);
      }
      const removed = vault.remove(arg);
      if (removed) {
        console.log(`  ✅ Secret "${arg}" removed.`);
      } else {
        console.log(`  ⚠️  Secret "${arg}" not found.`);
      }
      break;
    }

    default:
      console.error(`  ❌ Unknown secret command: ${action}`);
      process.exit(1);
  }
}
