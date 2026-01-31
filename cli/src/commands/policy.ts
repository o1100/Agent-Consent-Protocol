/**
 * acp policy — Manage consent policies
 *
 * Commands:
 *   acp policy apply <file>   Load and validate a YAML policy
 *   acp policy show            Display current policy
 */

import fs from 'node:fs';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { PolicyParser } from '../policy/parser.js';

const ACP_DIR = path.join(process.env.HOME || '~', '.acp');
const POLICY_PATH = path.join(ACP_DIR, 'policy.yml');

export async function policyCommand(action: string, file?: string): Promise<void> {
  switch (action) {
    case 'apply': {
      if (!file) {
        console.error('  ❌ Usage: acp policy apply <file>');
        process.exit(1);
      }

      const resolvedPath = path.resolve(file);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`  ❌ File not found: ${resolvedPath}`);
        process.exit(1);
      }

      // Parse and validate
      try {
        const policy = PolicyParser.parseFile(resolvedPath);
        const errors = PolicyParser.validate(policy);

        if (errors.length > 0) {
          console.error('  ❌ Policy validation errors:');
          for (const error of errors) {
            console.error(`    - ${error}`);
          }
          process.exit(1);
        }

        // Copy to active policy location
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        fs.writeFileSync(POLICY_PATH, content, 'utf-8');
        console.log(`  ✅ Policy applied from ${resolvedPath}`);
        console.log(`  Rules: ${policy.rules?.length || 0}`);
        console.log(`  Default action: ${policy.default_action}`);
      } catch (err) {
        console.error(`  ❌ Failed to parse policy: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case 'show': {
      if (!fs.existsSync(POLICY_PATH)) {
        console.log('  No policy configured. Run: acp init');
        return;
      }

      try {
        const policy = PolicyParser.parseFile(POLICY_PATH);
        console.log('');
        console.log('  Current ACP Policy');
        console.log('  ──────────────────');
        console.log('');
        console.log(yamlStringify(policy).split('\n').map(l => '  ' + l).join('\n'));
      } catch (err) {
        console.error(`  ❌ Failed to read policy: ${(err as Error).message}`);
      }
      break;
    }

    default:
      console.error(`  ❌ Unknown policy command: ${action}`);
      process.exit(1);
  }
}
