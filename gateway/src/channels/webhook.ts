/**
 * ACP Gateway — Webhook Channel Adapter
 *
 * Generic webhook adapter that sends consent requests to any
 * HTTP endpoint. Useful for custom dashboards, Slack bots,
 * or other integrations.
 */

import type { ConsentRequest, ChannelAdapter } from '../types.js';

export interface WebhookAdapterConfig {
  /** URL to POST consent requests to */
  webhookUrl: string;
  /** Optional authorization header */
  authHeader?: string;
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Timeout for webhook delivery in ms (default: 10000) */
  timeoutMs?: number;
  /** Retry count on failure (default: 3) */
  retries?: number;
}

export class WebhookAdapter implements ChannelAdapter {
  readonly name = 'webhook';
  private config: WebhookAdapterConfig;

  constructor(config: WebhookAdapterConfig) {
    this.config = config;
  }

  /**
   * Send a consent request to the configured webhook URL.
   */
  async deliverRequest(request: ConsentRequest): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ACP-Gateway/0.1.0',
      'X-ACP-Event': 'consent_request',
      'X-ACP-Request-ID': request.id,
      ...this.config.headers,
    };

    if (this.config.authHeader) {
      headers['Authorization'] = this.config.authHeader;
    }

    const body = JSON.stringify({
      event: 'consent_request',
      timestamp: new Date().toISOString(),
      request,
    });

    const maxRetries = this.config.retries ?? 3;
    const timeout = this.config.timeoutMs ?? 10000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
        }

        return; // Success
      } catch (err) {
        lastError = err as Error;
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw new Error(
      `Failed to deliver consent request to webhook after ${maxRetries + 1} attempts: ${lastError?.message}`
    );
  }

  /**
   * Cancel a pending request via webhook.
   */
  async cancelRequest(requestId: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ACP-Gateway/0.1.0',
      'X-ACP-Event': 'consent_cancelled',
      'X-ACP-Request-ID': requestId,
      ...this.config.headers,
    };

    if (this.config.authHeader) {
      headers['Authorization'] = this.config.authHeader;
    }

    try {
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event: 'consent_cancelled',
          timestamp: new Date().toISOString(),
          request_id: requestId,
        }),
      });
    } catch {
      // Best effort — don't throw on cancel failures
    }
  }

  /**
   * Check if the webhook endpoint is reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.config.webhookUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok || response.status === 405; // 405 = endpoint exists but doesn't support HEAD
    } catch {
      return false;
    }
  }
}
