#!/usr/bin/env node
/**
 * ACP Gateway — Main Entry Point
 *
 * Run with: npx acp-gateway
 * Or:       docker run -p 3000:3000 acp-gateway
 *
 * Configuration via environment variables:
 *   ACP_PORT            — Server port (default: 3000)
 *   ACP_DB_PATH         — SQLite database path (default: ./data/acp.db)
 *   ACP_POLICY_PATH     — Policy JSON file path
 *   ACP_AUDIT_PATH      — Audit log JSONL file path (default: ./data/audit.jsonl)
 *   ACP_API_KEY          — API key for authentication
 *   ACP_SIGNING_KEY      — Ed25519 signing key (hex)
 *   ACP_TIMEOUT_SECONDS  — Default consent timeout (default: 900)
 *   ACP_TELEGRAM_TOKEN   — Telegram bot token (enables Telegram adapter)
 *   ACP_TELEGRAM_CHAT_ID — Telegram chat ID for notifications
 *   ACP_WEBHOOK_URL      — Webhook URL for notifications
 */

import fs from 'node:fs';
import path from 'node:path';
import { createGatewayServer, type GatewayConfig } from './server.js';
import { TelegramAdapter } from './channels/telegram.js';
import { WebhookAdapter } from './channels/webhook.js';
import { CLIAdapter } from './channels/cli.js';
import type { ChannelAdapter } from './types.js';

// ─── Configuration ───────────────────────────────────────────────

const PORT = parseInt(process.env.ACP_PORT || '3000', 10);
const DB_PATH = process.env.ACP_DB_PATH || './data/acp.db';
const POLICY_PATH = process.env.ACP_POLICY_PATH;
const AUDIT_PATH = process.env.ACP_AUDIT_PATH || './data/audit.jsonl';
const API_KEY = process.env.ACP_API_KEY;
const SIGNING_KEY = process.env.ACP_SIGNING_KEY;
const TIMEOUT_SECONDS = parseInt(process.env.ACP_TIMEOUT_SECONDS || '900', 10);

// Telegram
const TELEGRAM_TOKEN = process.env.ACP_TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.ACP_TELEGRAM_CHAT_ID;

// Webhook
const WEBHOOK_URL = process.env.ACP_WEBHOOK_URL;

// CLI mode
const CLI_MODE = process.env.ACP_CLI_MODE === 'true';

// ─── Ensure Data Directory ───────────────────────────────────────

const dataDir = path.dirname(DB_PATH);
if (dataDir !== '.' && dataDir !== ':memory:') {
  fs.mkdirSync(dataDir, { recursive: true });
}

const auditDir = path.dirname(AUDIT_PATH);
if (auditDir !== '.') {
  fs.mkdirSync(auditDir, { recursive: true });
}

// ─── Setup Channel Adapters ─────────────────────────────────────

const channels: ChannelAdapter[] = [];

if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
  console.log('[ACP] Telegram adapter enabled');
  const telegram = new TelegramAdapter({
    botToken: TELEGRAM_TOKEN,
    chatId: TELEGRAM_CHAT_ID,
    gatewayUrl: `http://localhost:${PORT}`,
  });

  // Wire up Telegram responses to gateway
  telegram.onResponse(async (requestId, decision, approverId) => {
    try {
      const response = await fetch(
        `http://localhost:${PORT}/api/v1/consent/${requestId}/respond`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
          },
          body: JSON.stringify({
            decision,
            approver_id: approverId,
            channel: 'telegram',
          }),
        }
      );

      if (!response.ok) {
        console.error(`[ACP] Failed to submit Telegram response: ${response.status}`);
      }
    } catch (err) {
      console.error('[ACP] Error submitting Telegram response:', err);
    }
  });

  channels.push(telegram);
}

if (WEBHOOK_URL) {
  console.log(`[ACP] Webhook adapter enabled → ${WEBHOOK_URL}`);
  channels.push(new WebhookAdapter({ webhookUrl: WEBHOOK_URL }));
}

if (CLI_MODE) {
  console.log('[ACP] CLI adapter enabled');
  const cli = new CLIAdapter();

  cli.onResponse(async (requestId, decision, approverId) => {
    try {
      await fetch(`http://localhost:${PORT}/api/v1/consent/${requestId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify({
          decision,
          approver_id: approverId,
          channel: 'cli',
        }),
      });
    } catch (err) {
      console.error('[ACP] Error submitting CLI response:', err);
    }
  });

  channels.push(cli);
}

// ─── Start Server ────────────────────────────────────────────────

const config: GatewayConfig = {
  port: PORT,
  dbPath: DB_PATH,
  policyPath: POLICY_PATH,
  auditPath: AUDIT_PATH,
  apiKey: API_KEY,
  defaultTimeoutSeconds: TIMEOUT_SECONDS,
  signingKeyHex: SIGNING_KEY,
  channels,
};

const { app, cleanup, keyPair } = createGatewayServer(config);

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🔐 Agent Consent Protocol Gateway v0.1.0                ║
║                                                           ║
║   Server:    http://localhost:${PORT}                       ║
║   Health:    http://localhost:${PORT}/health                ║
║   Database:  ${DB_PATH.padEnd(42)}║
║   Audit:     ${AUDIT_PATH.padEnd(42)}║
║   Channels:  ${(channels.map(c => c.name).join(', ') || 'none').padEnd(42)}║
║   Auth:      ${(API_KEY ? 'enabled' : 'disabled').padEnd(42)}║
║                                                           ║
║   Public Key: ${keyPair.publicKey.substring(0, 40)}...   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// ─── Graceful Shutdown ───────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[ACP] Shutting down...');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[ACP] Shutting down...');
  cleanup();
  process.exit(0);
});
