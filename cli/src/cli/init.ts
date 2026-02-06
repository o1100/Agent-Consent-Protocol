/**
 * acp init — Setup wizard
 *
 * Creates ~/.acp/ with config and default policy.
 * Configures the consent channel (Telegram or webhook).
 * Optionally configures OpenClaw messaging bot (~/.openclaw/openclaw.json).
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
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
    console.log('  Telegram Consent Bot Setup');
    console.log('  ──────────────────────────');
    console.log('  This bot sends you approval requests when agents try to');
    console.log('  run sensitive commands. You approve or deny from Telegram.');
    console.log('');
    console.log('  1. Create a NEW bot via @BotFather (name it e.g. "ACP Consent")');
    console.log('  2. Open Telegram and search for your bot by username');
    console.log('  3. Send any message to the bot (e.g. "hi")');
    console.log('  4. Get your chat ID from:');
    console.log('     https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('');

    const botToken = await prompt.ask('  Consent Bot Token: ');
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

    // Send a test message to verify the connection works
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: 'ACP connected. Consent requests will appear here when agents need approval.',
          }),
        }
      );
      const data = await res.json() as { ok: boolean; description?: string };
      if (data.ok) {
        console.log('  Telegram verified (test message sent)');
      } else {
        console.error(`  Warning: Telegram test failed: ${data.description}`);
        console.error('  Check your bot token and chat ID.');
      }
    } catch {
      console.error('  Warning: Could not reach Telegram API.');
    }
    console.log('');

    // --- Optional: OpenClaw messaging bot setup ---
    const setupOC = await prompt.ask('  Configure OpenClaw messaging bot? [y/N] ');
    if (setupOC.toLowerCase() === 'y' || setupOC.toLowerCase() === 'yes') {
      await setupOpenClaw(prompt, chatId);
    }
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
    // dist/cli/init.js -> dist/cli -> dist -> cli -> repo root
    const templatesDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..', '..', '..', 'templates'
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
  console.log('    acp start openclaw');
  console.log('');
}

// ---------------------------------------------------------------------------
// OpenClaw messaging bot configuration
// ---------------------------------------------------------------------------

async function setupOpenClaw(
  prompt: { ask: (q: string) => Promise<string> },
  chatId: string,
): Promise<void> {
  const OC_DIR = path.join(process.env.HOME || '~', '.openclaw');
  const OC_CONFIG = path.join(OC_DIR, 'openclaw.json');

  console.log('');
  console.log('  OpenClaw Messaging Bot Setup');
  console.log('  ────────────────────────────');
  console.log('  This is a DIFFERENT bot from the consent bot above.');
  console.log('  The messaging bot is the one users chat with to talk to the AI agent.');
  console.log('  Create another bot via @BotFather (name it e.g. "OpenClaw Agent").');
  console.log('');

  const msgBotToken = await prompt.ask('  Messaging Bot Token (different from consent bot): ');
  if (!msgBotToken) {
    console.log('  Skipping OpenClaw setup (no token provided).');
    return;
  }

  // Verify the messaging bot token
  try {
    const res = await fetch(`https://api.telegram.org/bot${msgBotToken}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string }; description?: string };
    if (data.ok) {
      console.log(`  Bot verified: @${data.result?.username}`);
    } else {
      console.error(`  Warning: Bot token check failed: ${data.description}`);
    }
  } catch {
    console.error('  Warning: Could not verify bot token.');
  }

  console.log('');
  console.log('  Important: Do NOT call getUpdates on the messaging bot.');
  console.log('  That will consume messages and OpenClaw will not see them.');
  console.log('  (getUpdates is only for the consent bot to fetch your chat ID.)');
  console.log('');

  // Clear any pending updates (e.g. if getUpdates was used previously)
  try {
    await fetch(`https://api.telegram.org/bot${msgBotToken}/deleteWebhook?drop_pending_updates=true`);
  } catch {
    // Non-fatal
  }

  const anthropicToken = await prompt.ask('  Anthropic API key or Claude Code token: ');
  const isClaudeCodeToken = anthropicToken ? anthropicToken.startsWith('sk-ant-oat01-') : false;
  if (anthropicToken && isClaudeCodeToken) {
    console.log('  Detected Claude Code token → saving as ANTHROPIC_OAUTH_TOKEN');
  }

  // Best-effort validation for API keys (oauth tokens use different endpoints)
  if (anthropicToken && !isClaudeCodeToken) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': anthropicToken,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!res.ok) {
        console.error(`  Warning: Anthropic key test failed (${res.status}).`);
        console.error('  OpenClaw will not reply without a valid key.');
      }
    } catch {
      console.error('  Warning: Could not verify Anthropic API key.');
    }
  }

  // Best-effort validation for Claude Code tokens (OAuth)
  if (anthropicToken && isClaudeCodeToken) {
    try {
      const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: {
          Authorization: `Bearer ${anthropicToken}`,
          'User-Agent': 'openclaw',
          Accept: 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`  Warning: Claude Code token test failed (${res.status}).`);
        if (text.includes('scope requirement')) {
          console.error('  This token is missing required scopes (e.g. user:profile).');
        }
        console.error('  OpenClaw may not reply without a valid OAuth token.');
      }
    } catch {
      console.error('  Warning: Could not verify Claude Code token.');
    }
  }
  const braveKey = await prompt.ask('  Brave Search API Key (optional, press Enter to skip): ');

  // Build the OpenClaw config with correct schema
  const ocConfig: Record<string, unknown> = {
    gateway: {
      mode: 'local',
    },
    channels: {
      telegram: {
        enabled: true,
        botToken: msgBotToken,
        dmPolicy: 'allowlist',
        allowFrom: [chatId],
      },
    },
    plugins: {
      entries: {
        telegram: { enabled: true },
      },
    },
  };

  // API keys go in the env section (loaded as process env by OpenClaw)
  const env: Record<string, string> = {};
  if (anthropicToken) {
    if (isClaudeCodeToken) {
      env.ANTHROPIC_OAUTH_TOKEN = anthropicToken;
    } else {
      env.ANTHROPIC_API_KEY = anthropicToken;
    }
  }
  if (braveKey) env.BRAVE_API_KEY = braveKey;
  if (Object.keys(env).length > 0) {
    ocConfig.env = env;
  }

  // Write config
  fs.mkdirSync(OC_DIR, { recursive: true });
  fs.writeFileSync(OC_CONFIG, JSON.stringify(ocConfig, null, 2) + '\n', 'utf-8');
  console.log(`  OpenClaw config saved to ${OC_CONFIG}`);

  // Try running openclaw setup if the binary is available
  try {
    const ocBin = execSync('which openclaw 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
    if (ocBin) {
      console.log('  Running openclaw setup...');
      execSync(`${ocBin} setup --non-interactive 2>/dev/null || true`, {
        encoding: 'utf-8',
        timeout: 15000,
      });
    }
  } catch {
    // openclaw not installed yet — that's fine
  }

  console.log('');
  console.log('  OpenClaw configured. To start the gateway inside ACP containment:');
  console.log('');
  console.log('    acp start openclaw');
  console.log('');
}
