/**
 * ACP Gateway — Telegram Channel Adapter
 *
 * Sends consent requests as Telegram messages with inline buttons.
 * Handles approval/denial callbacks and forwards them to the gateway.
 */

import TelegramBot from 'node-telegram-bot-api';
import type { ConsentRequest, ChannelAdapter } from '../types.js';

const RISK_EMOJI: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
  critical: '⛔',
};

const CATEGORY_EMOJI: Record<string, string> = {
  communication: '💬',
  financial: '💰',
  data: '📊',
  system: '⚙️',
  public: '📢',
  identity: '🪪',
  physical: '🏠',
};

export interface TelegramAdapterConfig {
  botToken: string;
  chatId: string | number;
  /** Callback URL for the gateway respond endpoint */
  gatewayUrl: string;
  /** Timeout in seconds before auto-denying (default: 900) */
  timeoutSeconds?: number;
}

export interface TelegramResponseHandler {
  (requestId: string, decision: 'approved' | 'denied', approverId: string): Promise<void>;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name = 'telegram';
  private bot: TelegramBot;
  private chatId: string | number;
  private gatewayUrl: string;
  private timeoutSeconds: number;
  private pendingMessages: Map<string, number> = new Map(); // requestId → messageId
  private pendingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private responseHandler?: TelegramResponseHandler;

  constructor(config: TelegramAdapterConfig) {
    this.chatId = config.chatId;
    this.gatewayUrl = config.gatewayUrl;
    this.timeoutSeconds = config.timeoutSeconds ?? 900;

    // Initialize bot (polling mode for simplicity; production should use webhooks)
    this.bot = new TelegramBot(config.botToken, { polling: true });
    this.setupCallbackHandler();
  }

  /**
   * Register a handler for approval/denial responses.
   */
  onResponse(handler: TelegramResponseHandler): void {
    this.responseHandler = handler;
  }

  /**
   * Send a consent request as a Telegram message with inline buttons.
   */
  async deliverRequest(request: ConsentRequest): Promise<void> {
    const risk = request.action.risk_level;
    const category = request.action.category;
    const riskEmoji = RISK_EMOJI[risk] || '❓';
    const catEmoji = CATEGORY_EMOJI[category] || '❓';

    // Format parameters (truncate if too long)
    let paramsStr = JSON.stringify(request.action.parameters, null, 2);
    if (paramsStr.length > 500) {
      paramsStr = paramsStr.substring(0, 497) + '...';
    }

    // Calculate remaining time
    const expiresAt = new Date(request.expires_at);
    const remainingMs = expiresAt.getTime() - Date.now();
    const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));

    const text = [
      `🤖 *Agent Consent Request*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `*Agent:* ${this.escapeMarkdown(request.agent.name || request.agent.id)}`,
      `*Action:* \`${request.action.tool}\``,
      `*Risk:* ${riskEmoji} ${risk.toUpperCase()}`,
      `*Category:* ${catEmoji} ${category}`,
      ``,
      `📝 *Description:*`,
      this.escapeMarkdown(request.action.description),
      ``,
      `📋 *Parameters:*`,
      `\`\`\`json`,
      paramsStr,
      `\`\`\``,
    ];

    if (request.context?.conversation_summary) {
      text.push(
        ``,
        `💡 *Context:*`,
        this.escapeMarkdown(request.context.conversation_summary)
      );
    }

    text.push(
      ``,
      `⏰ Expires in: ${remainingMin} min`,
      `📎 ID: \`${request.id}\``
    );

    const keyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `acp:approve:${request.id}` },
          { text: '❌ Deny', callback_data: `acp:deny:${request.id}` },
        ],
      ],
    };

    const msg = await this.bot.sendMessage(this.chatId, text.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    this.pendingMessages.set(request.id, msg.message_id);

    // Set auto-deny timeout
    const timeout = setTimeout(async () => {
      await this.handleTimeout(request.id);
    }, Math.min(remainingMs, this.timeoutSeconds * 1000));

    this.pendingTimeouts.set(request.id, timeout);
  }

  /**
   * Cancel a pending consent request.
   */
  async cancelRequest(requestId: string): Promise<void> {
    const messageId = this.pendingMessages.get(requestId);
    if (messageId) {
      try {
        await this.bot.editMessageText(
          `🚫 *Cancelled* — Request \`${requestId}\` was cancelled by the agent.`,
          {
            chat_id: this.chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
          }
        );
      } catch {
        // Message might already be deleted
      }
    }
    this.cleanup(requestId);
  }

  /**
   * Check if the Telegram bot is working.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const me = await this.bot.getMe();
      return !!me.id;
    } catch {
      return false;
    }
  }

  /**
   * Set up the callback query handler for inline button presses.
   */
  private setupCallbackHandler(): void {
    this.bot.on('callback_query', async (query) => {
      if (!query.data?.startsWith('acp:')) return;

      const parts = query.data.split(':');
      if (parts.length !== 3) return;

      const [, action, requestId] = parts;
      const approverId = `tg_${query.from.id}`;

      if (!this.pendingMessages.has(requestId)) {
        await this.bot.answerCallbackQuery(query.id, {
          text: 'This request has already been handled or expired.',
          show_alert: true,
        });
        return;
      }

      const decision = action === 'approve' ? 'approved' : 'denied';
      const emoji = decision === 'approved' ? '✅' : '❌';
      const label = decision === 'approved' ? 'Approved' : 'Denied';

      // Update the message
      try {
        const messageId = this.pendingMessages.get(requestId)!;
        await this.bot.editMessageText(
          `${emoji} *${label}* by ${query.from.first_name || 'User'}\n` +
          `Request: \`${requestId}\`\n` +
          `Decision: ${label} at ${new Date().toISOString()}`,
          {
            chat_id: this.chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
          }
        );
      } catch {
        // Message edit might fail
      }

      // Answer the callback
      await this.bot.answerCallbackQuery(query.id, {
        text: `${label}!`,
      });

      // Forward to handler
      if (this.responseHandler) {
        await this.responseHandler(requestId, decision as 'approved' | 'denied', approverId);
      }

      this.cleanup(requestId);
    });
  }

  /**
   * Handle request timeout — auto-deny and update message.
   */
  private async handleTimeout(requestId: string): Promise<void> {
    const messageId = this.pendingMessages.get(requestId);
    if (!messageId) return;

    try {
      await this.bot.editMessageText(
        `⏰ *Expired* — Request \`${requestId}\` timed out (auto-denied).`,
        {
          chat_id: this.chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
        }
      );
    } catch {
      // Message edit might fail
    }

    if (this.responseHandler) {
      await this.responseHandler(requestId, 'denied', 'system_timeout');
    }

    this.cleanup(requestId);
  }

  /**
   * Clean up tracking data for a request.
   */
  private cleanup(requestId: string): void {
    this.pendingMessages.delete(requestId);
    const timeout = this.pendingTimeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(requestId);
    }
  }

  /**
   * Escape Markdown special characters for Telegram.
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }

  /**
   * Stop the bot and clean up.
   */
  stop(): void {
    this.bot.stopPolling();
    for (const timeout of this.pendingTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.pendingMessages.clear();
    this.pendingTimeouts.clear();
  }
}
