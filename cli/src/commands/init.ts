/**
 * acp init — Interactive setup wizard
 *
 * Creates ~/.acp/ with config, keys, default policy, vault,
 * and directories for hooks and bin.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { generateKeyPair } from '../crypto/keys.js';
import { getDefaultPolicy } from '../policy/defaults.js';
import { stringify as yamlStringify } from 'yaml';

const ACP_DIR = path.join(process.env.HOME || '~', '.acp');
const CONFIG_PATH = path.join(ACP_DIR, 'config.yml');
const KEYS_DIR = path.join(ACP_DIR, 'keys');
const VAULT_PATH = path.join(ACP_DIR, 'vault.json');
const POLICY_PATH = path.join(ACP_DIR, 'policy.yml');
const HOOKS_DIR = path.join(ACP_DIR, 'hooks');
const BIN_DIR = path.join(ACP_DIR, 'bin');

interface InitOptions {
  channel: string;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log('');
  console.log('  🔐 ACP — Agent Consent Protocol');
  console.log('  ─────────────────────────────────');
  console.log('');

  // Create directories
  fs.mkdirSync(ACP_DIR, { recursive: true });
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Generate Ed25519 key pair
  console.log('  Generating Ed25519 key pair...');
  const keys = generateKeyPair();
  fs.writeFileSync(path.join(KEYS_DIR, 'private.key'), keys.privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(KEYS_DIR, 'public.key'), keys.publicKey, { mode: 0o644 });
  console.log('  ✅ Keys generated');
  console.log('');

  // Channel configuration
  const channel = options.channel;
  const config: Record<string, unknown> = {
    version: '2',
    channel,
    proxy: {
      port: 8443,
      upstream_servers: [],
    },
    http_proxy: {
      enabled: true,
      port: 8444,
    },
    shell_intercept: {
      enabled: true,
      fail_mode: 'deny',
      commands: [
        'curl', 'wget', 'ssh', 'scp', 'nc',
        'python', 'python3', 'node',
        'rm', 'rmdir', 'mv', 'chmod',
        'pip', 'pip3', 'npm', 'npx', 'brew',
        'git', 'docker', 'kubectl',
      ],
    },
    defaults: {
      timeout_seconds: 120,
      policy: POLICY_PATH,
    },
  };

  if (channel === 'telegram') {
    console.log('  📱 Telegram Setup');
    console.log('  Create a bot via @BotFather and get the token.');
    console.log('  Send a message to the bot, then get your chat ID from:');
    console.log('  https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('');

    const botToken = await prompt('  Telegram Bot Token: ');
    const chatId = await prompt('  Telegram Chat ID: ');

    if (!botToken || !chatId) {
      console.error('  ❌ Bot token and chat ID are required for Telegram channel.');
      process.exit(1);
    }

    config.telegram = {
      bot_token: botToken,
      chat_id: chatId,
    };
    console.log('  ✅ Telegram configured');
    console.log('');
  } else if (channel === 'webhook') {
    const url = await prompt('  Webhook URL: ');
    const secret = await prompt('  Webhook Secret (optional): ');

    config.webhook = {
      url,
      ...(secret ? { secret } : {}),
    };
    console.log('  ✅ Webhook configured');
    console.log('');
  } else {
    console.log('  📟 Using terminal prompts for approvals.');
    console.log('');
  }

  // Write config
  fs.writeFileSync(CONFIG_PATH, yamlStringify(config), 'utf-8');
  console.log(`  ✅ Config saved to ${CONFIG_PATH}`);

  // Write default policy
  const defaultPolicy = getDefaultPolicy();
  fs.writeFileSync(POLICY_PATH, yamlStringify(defaultPolicy), 'utf-8');
  console.log(`  ✅ Default policy saved to ${POLICY_PATH}`);

  // Initialize empty vault
  if (!fs.existsSync(VAULT_PATH)) {
    fs.writeFileSync(VAULT_PATH, JSON.stringify({ version: 1, secrets: {} }, null, 2), {
      mode: 0o600,
    });
    console.log(`  ✅ Credential vault created at ${VAULT_PATH}`);
  }

  console.log('');
  console.log('  🎉 ACP initialized! Try:');
  console.log('');
  console.log('    acp secret set OPENAI_API_KEY=sk-...');
  console.log('    acp run -- python my_agent.py');
  console.log('');
  console.log('  New in v0.3:');
  console.log('    acp setup claude-code     # Hook into Claude Code');
  console.log('    acp setup openclaw        # OpenClaw integration help');
  console.log('');
}
