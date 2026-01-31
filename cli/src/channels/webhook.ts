/**
 * Webhook Channel Adapter
 *
 * Sends consent requests to an external HTTP endpoint and
 * receives decisions synchronously or via callback.
 *
 * For the MVP, the basic implementation in terminal.ts handles
 * webhook functionality. This file will contain the production
 * version with:
 * - HMAC signature verification
 * - Async callback support (webhook posts back to ACP)
 * - Retry with exponential backoff
 * - Webhook secret rotation
 */

export { WebhookChannelStub as WebhookChannel } from './terminal.js';
