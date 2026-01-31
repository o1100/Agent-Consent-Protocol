/**
 * Terminal Channel Adapter
 *
 * Displays consent requests in the terminal and waits for
 * the user to approve or deny. Zero dependencies, works everywhere.
 */

import readline from 'node:readline';
import type { ChannelAdapter, ConsentDisplayRequest, ConsentDecision } from '../proxy/consent-gate.js';

const RISK_ICONS: Record<string, string> = {
  low: '🟢 LOW',
  medium: '🟡 MEDIUM',
  high: '🔴 HIGH',
  critical: '⛔ CRITICAL',
};

class TerminalChannel implements ChannelAdapter {
  name = 'terminal';

  async requestConsent(request: ConsentDisplayRequest): Promise<ConsentDecision> {
    // Display the consent request
    console.log('');
    console.log('  ════════════════════════════════════════════════════');
    console.log('    🔐 ACP CONSENT REQUEST');
    console.log('  ════════════════════════════════════════════════════');
    console.log(`    Action:   ${request.tool}`);
    console.log(`    Risk:     ${RISK_ICONS[request.riskLevel] || request.riskLevel}`);
    console.log(`    Category: ${request.category}`);
    if (request.policyRule) {
      console.log(`    Rule:     ${request.policyRule}`);
    }
    console.log('  ────────────────────────────────────────────────────');

    // Display arguments
    const args = request.arguments;
    if (Object.keys(args).length > 0) {
      console.log('    Parameters:');
      const formatted = JSON.stringify(args, null, 2)
        .split('\n')
        .map(line => '      ' + line)
        .join('\n');
      console.log(formatted);
    }

    console.log('  ════════════════════════════════════════════════════');
    console.log('');

    // Prompt for decision
    const answer = await prompt('  Approve? [y/N/m(odify)] ');
    const choice = answer.toLowerCase().trim();

    if (choice === 'y' || choice === 'yes') {
      console.log('  ✅ Approved');
      return { approved: true };
    } else if (choice === 'm' || choice === 'modify') {
      // Allow modifications
      const modsJson = await prompt('  Modifications (JSON): ');
      try {
        const modifications = JSON.parse(modsJson);
        console.log('  ✅ Approved with modifications');
        return { approved: true, modifications };
      } catch {
        console.log('  ❌ Invalid JSON. Denying.');
        return { approved: false, reason: 'Invalid modification JSON' };
      }
    } else {
      const reason = choice === '' ? 'No response (default deny)' : `User denied: ${answer}`;
      console.log('  ❌ Denied');
      return { approved: false, reason };
    }
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Factory: create the appropriate channel adapter based on config.
 */
export function createChannel(config: Record<string, unknown>): ChannelAdapter {
  const channelType = config.channel as string;

  switch (channelType) {
    case 'telegram':
      // Lazy import to avoid requiring telegram deps when not used
      return new TelegramChannelStub(config);
    case 'webhook':
      return new WebhookChannelStub(config);
    case 'prompt':
    default:
      return new TerminalChannel();
  }
}

/**
 * Telegram channel stub — will be replaced by full implementation.
 */
export class TelegramChannelStub implements ChannelAdapter {
  name = 'telegram';
  private botToken: string;
  private chatId: string;

  constructor(config: Record<string, unknown>) {
    const telegram = config.telegram as Record<string, string> | undefined;
    this.botToken = telegram?.bot_token || '';
    this.chatId = telegram?.chat_id || '';
  }

  async requestConsent(request: ConsentDisplayRequest): Promise<ConsentDecision> {
    if (!this.botToken || !this.chatId) {
      console.error('  ❌ Telegram not configured. Run: acp init --channel=telegram');
      return { approved: false, reason: 'Telegram not configured' };
    }

    // Send consent request to Telegram with inline buttons
    const text = [
      '🔐 *ACP Consent Request*',
      '',
      `*Action:* \`${request.tool}\``,
      `*Risk:* ${RISK_ICONS[request.riskLevel] || request.riskLevel}`,
      `*Category:* ${request.category}`,
      '',
      `\`\`\`json`,
      JSON.stringify(request.arguments, null, 2),
      `\`\`\``,
    ].join('\n');

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `acp_approve_${request.id}` },
          { text: '❌ Deny', callback_data: `acp_deny_${request.id}` },
        ],
      ],
    };

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard,
        }),
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status}`);
      }

      const sendResult = await response.json() as { ok: boolean; result?: { message_id: number } };
      const messageId = sendResult.result?.message_id;

      // Poll for callback response
      console.log('  📱 Consent request sent to Telegram. Waiting for response...');
      return await this.waitForCallback(request.id, messageId);
    } catch (err) {
      console.error(`  ❌ Telegram error: ${(err as Error).message}`);
      // Fallback to terminal
      console.log('  Falling back to terminal prompt...');
      const terminal = new TerminalChannel();
      return terminal.requestConsent(request);
    }
  }

  /**
   * Poll Telegram for callback query responses.
   */
  private async waitForCallback(requestId: string, messageId?: number, timeoutMs = 120000): Promise<ConsentDecision> {
    const startTime = Date.now();
    let lastUpdateId = 0;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=2`;
        const response = await fetch(url);
        const data = await response.json() as {
          ok: boolean;
          result: Array<{
            update_id: number;
            callback_query?: {
              data: string;
              id: string;
            };
          }>;
        };

        if (data.ok && data.result) {
          for (const update of data.result) {
            lastUpdateId = update.update_id;

            const isApprove = update.callback_query?.data === `acp_approve_${requestId}`;
            const isDeny = update.callback_query?.data === `acp_deny_${requestId}`;

            if ((isApprove || isDeny) && update.callback_query) {
              // Answer the callback immediately
              await fetch(`https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  callback_query_id: update.callback_query.id,
                  text: isApprove ? '✅ Approved' : '❌ Denied',
                }),
              });

              // Edit the original message to show the result (remove buttons)
              if (messageId) {
                const statusText = isApprove
                  ? '✅ *APPROVED*'
                  : '❌ *DENIED*';
                await fetch(`https://api.telegram.org/bot${this.botToken}/editMessageText`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: this.chatId,
                    message_id: messageId,
                    text: `🔐 *ACP Consent Request*\n\n${statusText}\n\n_Decision recorded\\._`,
                    parse_mode: 'Markdown',
                  }),
                }).catch(() => {});  // Best-effort edit
              }

              if (isApprove) {
                return { approved: true };
              }
              return { approved: false, reason: 'Denied via Telegram' };
            }
          }
        }
      } catch {
        // Retry on transient errors
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return { approved: false, reason: 'Consent request timed out' };
  }
}

/**
 * Webhook channel stub — sends consent requests to an HTTP endpoint.
 */
export class WebhookChannelStub implements ChannelAdapter {
  name = 'webhook';
  private url: string;
  private secret: string;

  constructor(config: Record<string, unknown>) {
    const webhook = config.webhook as Record<string, string> | undefined;
    this.url = webhook?.url || '';
    this.secret = webhook?.secret || '';
  }

  async requestConsent(request: ConsentDisplayRequest): Promise<ConsentDecision> {
    if (!this.url) {
      console.error('  ❌ Webhook URL not configured.');
      return { approved: false, reason: 'Webhook not configured' };
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.secret ? { 'X-ACP-Secret': this.secret } : {}),
        },
        body: JSON.stringify({
          type: 'consent_request',
          ...request,
        }),
      });

      const result = await response.json() as { approved: boolean; reason?: string };
      return result;
    } catch (err) {
      console.error(`  ❌ Webhook error: ${(err as Error).message}`);
      return { approved: false, reason: 'Webhook request failed' };
    }
  }
}
