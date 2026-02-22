/**
 * Channel — push notification adapters
 *
 * Sends consent requests to the human and waits for a response.
 * Primary: TelegramChannel (push notification with inline buttons)
 * Secondary: WebhookChannel (HTTP callback)
 */

import path from 'node:path';
import https from 'node:https';
import type { Action } from './types.js';

export interface ChannelResponse {
  approved: boolean;
  reason?: string;
}

export interface Channel {
  ask(action: Action, timeoutMs: number): Promise<ChannelResponse>;
}

// ---------------------------------------------------------------------------
// TelegramChannel — Telegram Bot API with inline keyboard
// ---------------------------------------------------------------------------

export class TelegramChannel implements Channel {
  private botToken: string;
  private chatId: string;
  private consentQueue: Promise<void>;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.consentQueue = Promise.resolve();
  }

  async ask(action: Action, timeoutMs: number): Promise<ChannelResponse> {
    const run = async (): Promise<ChannelResponse> => this.askInternal(action, timeoutMs);
    const queued = this.consentQueue.then(run, run);
    this.consentQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async askInternal(action: Action, timeoutMs: number): Promise<ChannelResponse> {
    if (!this.botToken || !this.chatId) {
      return { approved: false, reason: 'Telegram not configured' };
    }

    const text = formatAction(action);
    const requestId = `acp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const inlineKeyboard = {
      inline_keyboard: [[
        { text: 'Approve', callback_data: `approve_${requestId}` },
        { text: 'Deny', callback_data: `deny_${requestId}` },
      ]],
    };

    console.log(`  [telegram] Sending consent request (id=${requestId})`);
    try {
      let sendResult: Record<string, unknown>;
      try {
        sendResult = await this.telegramApi('sendMessage', {
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard,
        });
      } catch (err) {
        const message = (err as Error).message;
        const markdownParseFailed = /parse entities|can't parse|can't find end of/i.test(message);
        if (!markdownParseFailed) {
          throw err;
        }
        console.log('  [telegram] Markdown parse failed, retrying without Markdown...');
        sendResult = await this.telegramApi('sendMessage', {
          chat_id: this.chatId,
          text: stripTelegramMarkdown(text),
          reply_markup: inlineKeyboard,
        });
      }

      const messageId = extractMessageId(sendResult);
      console.log(`  [telegram] Consent request delivered (chat=${this.chatId}, message_id=${messageId ?? 'n/a'})`);
      console.log('  Consent request sent to Telegram. Waiting for response...');
      return await this.pollForResponse(requestId, messageId, timeoutMs);
    } catch (err) {
      return { approved: false, reason: `Telegram error: ${(err as Error).message}` };
    }
  }

  private async pollForResponse(
    requestId: string,
    messageId?: number,
    timeoutMs = 120000
  ): Promise<ChannelResponse> {
    const start = Date.now();
    let offset = 0;

    while (Date.now() - start < timeoutMs) {
      try {
        const data = await this.telegramApi('getUpdates', {
          offset: offset + 1,
          timeout: 2,
        });

        const updates = Array.isArray(data.result) ? data.result : [];
        if (updates.length > 0) {
          console.log(`  [telegram] Got ${updates.length} update(s)`);
        }

        for (const update of updates) {
          offset = typeof update.update_id === 'number' ? update.update_id : offset;
          console.log(`  [telegram] Update ${update.update_id}: ${update.message ? 'message' : update.callback_query ? 'callback' : 'other'}`);

          // Reply to text messages so the user knows the bot is alive
          const msg = update.message;
          if (msg?.text) {
            this.telegramApi('sendMessage', {
              chat_id: msg.chat.id,
              text: 'ACP bot is active. Waiting for a consent decision on the buttons above.',
            }).catch(() => {});
            continue;
          }

          const cb = update.callback_query;
          if (!cb) continue;

          const isApprove = cb.data === `approve_${requestId}`;
          const isDeny = cb.data === `deny_${requestId}`;

          if (isApprove || isDeny) {
            // Answer the callback query
            await this.telegramApi('answerCallbackQuery', {
              callback_query_id: cb.id,
              text: isApprove ? 'Approved' : 'Denied',
            }).catch(() => {});

            // Edit the original message to show result
            if (messageId) {
              const status = isApprove ? 'APPROVED' : 'DENIED';
              await this.telegramApi('editMessageText', {
                chat_id: this.chatId,
                message_id: messageId,
                text: `*ACP Consent Request*\n\n*${status}*\n\n_Decision recorded._`,
                parse_mode: 'Markdown',
              }).catch(() => {});
            }

            return isApprove
              ? { approved: true }
              : { approved: false, reason: 'Denied via Telegram' };
          }
        }
      } catch {
        // Retry on transient errors
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Edit message to show timeout
    if (messageId) {
      await this.telegramApi('editMessageText', {
        chat_id: this.chatId,
        message_id: messageId,
        text: '*ACP Consent Request*\n\n*TIMED OUT* (auto\\-denied)',
        parse_mode: 'Markdown',
      }).catch(() => {});
    }

    return { approved: false, reason: 'Timed out waiting for response' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async telegramApi(
    method: string,
    body: Record<string, unknown>
  ): Promise<any> {
    console.log(`  [telegram] API call: ${method}`);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const json = await postJson(
          `https://api.telegram.org/bot${this.botToken}/${method}`,
          body,
        );
        if (json.ok !== true) {
          const description = typeof json.description === 'string'
            ? json.description
            : 'unknown Telegram API error';
          const errorCode = typeof json.error_code === 'number'
            ? json.error_code
            : 0;
          throw new Error(`Telegram API ${method} failed (${errorCode}): ${description}`);
        }
        return json;
      } catch (err) {
        lastError = err as Error;
        console.log(`  [telegram] API ${method} attempt ${attempt}/3 failed: ${lastError.message}`);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        }
      }
    }

    throw lastError || new Error('Telegram API failed');
  }
}

// ---------------------------------------------------------------------------
// WebhookChannel — HTTP POST to external endpoint
// ---------------------------------------------------------------------------

export class WebhookChannel implements Channel {
  private url: string;
  private secret?: string;

  constructor(url: string, secret?: string) {
    this.url = url;
    this.secret = secret;
  }

  async ask(action: Action, timeoutMs: number): Promise<ChannelResponse> {
    if (!this.url) {
      return { approved: false, reason: 'Webhook URL not configured' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.secret ? { 'X-ACP-Secret': this.secret } : {}),
        },
        body: JSON.stringify({ type: 'consent_request', action }),
        signal: controller.signal,
      });
      return await res.json() as ChannelResponse;
    } catch (err) {
      return { approved: false, reason: `Webhook error: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessageId(payload: Record<string, unknown>): number | undefined {
  const result = payload.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return undefined;
  }
  const messageId = (result as Record<string, unknown>).message_id;
  if (typeof messageId === 'number') {
    return messageId;
  }
  return undefined;
}

function stripTelegramMarkdown(text: string): string {
  return text.replace(/[`*_]/g, '');
}

function formatAction(action: Action): string {
  const lines = ['*ACP Consent Request*', ''];

  if (action.meta.kind === 'shell') {
    // For runtime wrappers, extract the script basename as the display name
    let displayName = action.name;
    if (['node', 'python', 'python3'].includes(action.name) && action.args) {
      const firstArg = action.args.trim().split(/\s+/)[0];
      if (firstArg && !firstArg.startsWith('-')) {
        displayName = path.basename(firstArg);
      }
    }
    lines.push(`*Command:* \`${displayName}\``);
    if (action.args) {
      // Truncate long args for readability
      const display = action.args.length > 200
        ? action.args.slice(0, 200) + '...'
        : action.args;
      lines.push(`*Args:* \`${display}\``);
    }
  } else {
    lines.push(`*HTTP:* \`${action.meta.method || 'CONNECT'} ${action.meta.host || 'unknown'}\``);
    if (action.args) {
      lines.push(`*URL:* \`${action.args}\``);
    }
  }

  return lines.join('\n');
}

// Minimal HTTPS JSON POST helper with IPv4 preference to avoid
// intermittent fetch transport failures on some VM network stacks.
async function postJson(
  urlString: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(body);
  const url = new URL(urlString);

  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      family: 4,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          resolve(parsed);
        } catch {
          reject(new Error(`Invalid Telegram JSON response (status ${res.statusCode || 0})`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Telegram API request timeout'));
    });
    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}
