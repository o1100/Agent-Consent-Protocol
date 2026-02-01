/**
 * Audit Logger — Hash-chained JSONL audit trail
 *
 * Every ACP event is logged with:
 * - Cryptographic hash chaining (tamper-evident)
 * - Full context (tool, args, decision, timing)
 * - Append-only storage
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

export interface AuditEntry {
  event_type: string;
  agent: string;
  tool: string;
  category: string;
  risk_level: string;
  decision?: string;
  response_time_ms?: number;
  metadata?: Record<string, unknown>;
}

interface AuditEvent extends AuditEntry {
  type: 'audit_event';
  version: string;
  id: string;
  timestamp: string;
  previous_event_hash: string | null;
  event_hash: string;
}

export class AuditLogger {
  private logPath: string;
  private lastEventHash: string | null = null;
  private eventCount: number = 0;

  constructor(logPath: string) {
    this.logPath = logPath;
    this.restoreChainState();
  }

  /**
   * Restore hash chain state from existing log file.
   */
  private restoreChainState(): void {
    if (!fs.existsSync(this.logPath)) return;

    const content = fs.readFileSync(this.logPath, 'utf-8').trim();
    if (!content) return;

    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as AuditEvent;
        this.lastEventHash = event.event_hash;
        this.eventCount++;
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Compute SHA-256 hash of an object.
   */
  private computeHash(data: Record<string, unknown>): string {
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    return `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  }

  /**
   * Record an audit event.
   *
   * Each event is hash-chained to the previous event.
   * Tampering with any event breaks the chain.
   */
  record(entry: AuditEntry): AuditEvent {
    const eventWithoutHash = {
      type: 'audit_event' as const,
      version: '0.3.0',
      id: `ae_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
      previous_event_hash: this.lastEventHash,
    };

    const eventHash = this.computeHash(eventWithoutHash as unknown as Record<string, unknown>);

    const event: AuditEvent = {
      ...eventWithoutHash,
      event_hash: eventHash,
    };

    // Append to log file
    fs.appendFileSync(this.logPath, JSON.stringify(event) + '\n', 'utf-8');

    this.lastEventHash = eventHash;
    this.eventCount++;

    return event;
  }

  /**
   * Verify the integrity of the hash chain.
   */
  verifyChain(): { valid: boolean; eventCount: number; error?: string } {
    if (!fs.existsSync(this.logPath)) {
      return { valid: true, eventCount: 0 };
    }

    const content = fs.readFileSync(this.logPath, 'utf-8').trim();
    if (!content) return { valid: true, eventCount: 0 };

    const lines = content.split('\n').filter(Boolean);
    let previousHash: string | null = null;
    let count = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as AuditEvent;

        // Verify chain link
        if (event.previous_event_hash !== previousHash) {
          return {
            valid: false,
            eventCount: count,
            error: `Chain broken at event ${count + 1}: expected previous hash ${previousHash}, got ${event.previous_event_hash}`,
          };
        }

        // Verify event hash
        const { event_hash, ...rest } = event;
        const computed = this.computeHash(rest as unknown as Record<string, unknown>);
        if (computed !== event_hash) {
          return {
            valid: false,
            eventCount: count,
            error: `Hash mismatch at event ${count + 1}`,
          };
        }

        previousHash = event_hash;
        count++;
      } catch {
        return {
          valid: false,
          eventCount: count,
          error: `Malformed event at line ${count + 1}`,
        };
      }
    }

    return { valid: true, eventCount: count };
  }
}
