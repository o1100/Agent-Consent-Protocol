/**
 * acp init — Setup wizard
 *
 * Creates ~/.acp/ with config and default policy.
 * Configures the consent channel (Telegram or webhook).
 * No more keys, vault, or hooks — just channel + policy.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { stringify as yamlStringify } from 'yaml';

interface InitOptions {
  channel: string;
  config?: string;
}

function createPrompt(): { ask: (question: string) => Promise<string>; close: () => void } {
  const isTTY = process.stdin.isTTY;
  let lines: string[] | null = null;
  let lineIndex = 0;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: isTTY ?? false,
  });

  // For piped input, pre-read all lines to avoid race conditions
  const linesReady = isTTY
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const collected: string[] = [];
        rl.on('line', (line) => collected.push(line));
        rl.on('close', () => {
          lines = collected;
          resolve();
        });
      });

  return {
    async ask(question: string): Promise<string> {
      if (isTTY) {
        return new Promise((resolve) => {
          rl.question(question, (answer) => {
            resolve(answer.trim());
          });
        });
      }
      // Piped: read from pre-buffered lines
      await linesReady;
      process.stdout.write(question);
      const answer = lines?.[lineIndex++] ?? '';
      process.stdout.write(answer + '\n');
      return answer.trim();
    },
    close() {
      if (isTTY) rl.close();
    },
  };
}

export async function initCommand(options: InitOptions): Promise<void> {
  const ACP_DIR = options.config || path.join(process.env.HOME || '~', '.acp');
  const CONFIG_PATH = path.join(ACP_DIR, 'config.yml');
  const POLICY_PATH = path.join(ACP_DIR, 'policy.yml');

  console.log('');
  console.log('  ACP v0.3 — Agent Consent Protocol');
  console.log('  2FA for AI Agents');
  console.log('  ─────────────────────────────────');
  console.log('');

  // Create directory
  fs.mkdirSync(ACP_DIR, { recursive: true });

  // Build config
  const config: Record<string, unknown> = {
    version: '1.0',
    channel: options.channel,
  };

  const prompt = createPrompt();

  if (options.channel === 'telegram') {
    console.log('  Telegram Setup');
    console.log('  1. Create a bot via @BotFather and get the token');
    console.log('  2. Open Telegram and search for your bot by username');
    console.log('  3. Send any message to the bot (e.g. "hi")');
    console.log('  4. Get your chat ID from:');
    console.log('     https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('');

    const botToken = await prompt.ask('  Telegram Bot Token: ');
    const chatId = await prompt.ask('  Telegram Chat ID: ');

    if (!botToken || !chatId) {
      prompt.close();
      console.error('  Bot token and chat ID are required for Telegram.');
      process.exit(1);
    }

    config.telegram = {
      bot_token: botToken,
      chat_id: chatId,
    };
    console.log('  Telegram configured');
    console.log('');
  } else if (options.channel === 'webhook') {
    const url = await prompt.ask('  Webhook URL: ');
    const secret = await prompt.ask('  Webhook Secret (optional): ');

    config.webhook = {
      url,
      ...(secret ? { secret } : {}),
    };
    console.log('  Webhook configured');
    console.log('');
  } else {
    console.log('  Using terminal prompts for approvals.');
    console.log('  Note: --contained mode requires Telegram or webhook.');
    console.log('');
  }

  prompt.close();

  // Write config
  fs.writeFileSync(CONFIG_PATH, yamlStringify(config), 'utf-8');
  console.log(`  Config saved to ${CONFIG_PATH}`);

  // Copy default policy template if no policy exists
  if (!fs.existsSync(POLICY_PATH)) {
    // Find templates directory relative to this file
    const templatesDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..', '..', '..', '..', 'templates'
    );
    const defaultTemplatePath = path.join(templatesDir, 'default.yml');

    if (fs.existsSync(defaultTemplatePath)) {
      fs.copyFileSync(defaultTemplatePath, POLICY_PATH);
    } else {
      // Inline fallback
      const defaultPolicy = [
        'default: ask',
        '',
        'wrap:',
        '  - gh',
        '  - git',
        '  - curl',
        '  - wget',
        '  - ssh',
        '  - rm',
        '  - rmdir',
        '  - python',
        '  - python3',
        '  - node',
        '  - pip',
        '  - npm',
        '  - npx',
        '',
        'rules:',
        '  - match: { name: "node" }',
        '    action: allow',
        '  - match: { name: "python" }',
        '    action: allow',
        '  - match: { name: "python3" }',
        '    action: allow',
        '  - match: { name: "cat" }',
        '    action: allow',
        '  - match: { name: "ls" }',
        '    action: allow',
        '  - match: { kind: http, host: "*.anthropic.com" }',
        '    action: allow',
        '  - match: { kind: http, host: "*.openai.com" }',
        '    action: allow',
        '',
      ].join('\n');
      fs.writeFileSync(POLICY_PATH, defaultPolicy, 'utf-8');
    }
    console.log(`  Default policy saved to ${POLICY_PATH}`);
  }

  console.log('');
  console.log('  ACP initialized. Try:');
  console.log('');
  console.log('    acp contain -- python my_agent.py');
  console.log('    acp contain --policy strict.yml -- openclaw start');
  console.log('');
}
