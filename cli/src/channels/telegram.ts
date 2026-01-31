/**
 * Telegram Channel Adapter
 *
 * Sends consent requests as Telegram messages with inline
 * approve/deny buttons. Polls for callback query responses.
 *
 * This is the full implementation. The stub in terminal.ts
 * provides a basic version; this file will contain the
 * production-grade implementation with:
 * - Long polling with proper offset tracking
 * - Message editing (update status after decision)
 * - Timeout handling with auto-deny
 * - Error recovery and retry logic
 *
 * For the MVP, the implementation in terminal.ts handles
 * both terminal and basic Telegram functionality.
 */

export { TelegramChannelStub as TelegramChannel } from './terminal.js';

// Full implementation will go here in future versions.
// The terminal.ts file contains the working Telegram stub
// that handles sending messages and polling for callbacks.
