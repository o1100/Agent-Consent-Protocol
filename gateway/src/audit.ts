/**
 * ACP Gateway — Audit Trail
 *
 * Append-only, hash-chained audit log for all consent events.
 * Stored as JSONL (JSON Lines) with SHA-256 hash chaining for
 * tamper detection.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  AuditEvent,
  AuditEventType,
  ActionCategory,
  RiskLevel,
} from './types.js';

export interface AuditEntryParams {
  event_type: AuditEventType;
  request_id: string;
  agent_id: string;
  approver_id?: string;
  action_tool: string;
  action_category: ActionCategory;
  action_risk_level: RiskLevel;
  decision?: string;
  response_time_ms?: number;
  policy_evaluated?: string;
  policy_result?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryOptions {
  request_id?: string;
  agent_id?: string;
  approver_id?: string;
  event_type?: AuditEventType;
  action_category?: ActionCategory;
  risk_level?: RiskLevel;
  decision?: string;
  from?: string;  // ISO date
  to?: string;    // ISO date
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  chain_valid: boolean;
  chain_length: number;
}

export class AuditTrail {
  private logPath: string;
  private lastEventHash: string | null = null;
  private eventCount: number = 0;
  private events: AuditEvent[] = []; // In-memory cache for querying

  constructor(logPath: string) {
    this.logPath = logPath;
    this.loadExistingEvents();
  }

  /**
   * Load existing events from the log file to restore hash chain state.
   */
  private loadExistingEvents(): void {
    if (!fs.existsSync(this.logPath)) {
      return;
    }

    const content = fs.readFileSync(this.logPath, 'utf-8').trim();
    if (!content) return;

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as AuditEvent;
        this.events.push(event);
        this.lastEventHash = event.event_hash;
        this.eventCount++;
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Compute SHA-256 hash of an audit event (excluding the event_hash field).
   */
  private computeHash(event: Omit<AuditEvent, 'event_hash'>): string {
    const canonical = JSON.stringify(event, Object.keys(event).sort());
    const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    return `sha256:${hash}`;
  }

  /**
   * Record a new audit event.
   *
   * The event is hash-chained to the previous event, making the
   * audit trail tamper-evident. Any modification to a past event
   * will break the chain.
   */
  record(params: AuditEntryParams): AuditEvent {
    const now = new Date().toISOString();

    // Build the event without the hash
    const eventWithoutHash: Omit<AuditEvent, 'event_hash'> = {
      type: 'audit_event',
      version: '0.1.0',
      id: `ae_${uuidv4().replace(/-/g, '')}`,
      timestamp: now,
      event_type: params.event_type,
      request_id: params.request_id,
      agent_id: params.agent_id,
      approver_id: params.approver_id,
      action_tool: params.action_tool,
      action_category: params.action_category,
      action_risk_level: params.action_risk_level,
      decision: params.decision,
      response_time_ms: params.response_time_ms,
      policy_evaluated: params.policy_evaluated,
      policy_result: params.policy_result,
      metadata: params.metadata,
      previous_event_hash: this.lastEventHash,
    };

    // Compute hash including previous hash (chain link)
    const eventHash = this.computeHash(eventWithoutHash);

    const event: AuditEvent = {
      ...eventWithoutHash,
      event_hash: eventHash,
    };

    // Append to file
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.logPath, line, 'utf-8');

    // Update state
    this.lastEventHash = eventHash;
    this.eventCount++;
    this.events.push(event);

    return event;
  }

  /**
   * Query the audit trail with filters.
   */
  query(options: AuditQueryOptions = {}): AuditQueryResult {
    let filtered = this.events;

    if (options.request_id) {
      filtered = filtered.filter(e => e.request_id === options.request_id);
    }
    if (options.agent_id) {
      filtered = filtered.filter(e => e.agent_id === options.agent_id);
    }
    if (options.approver_id) {
      filtered = filtered.filter(e => e.approver_id === options.approver_id);
    }
    if (options.event_type) {
      filtered = filtered.filter(e => e.event_type === options.event_type);
    }
    if (options.action_category) {
      filtered = filtered.filter(e => e.action_category === options.action_category);
    }
    if (options.risk_level) {
      filtered = filtered.filter(e => e.action_risk_level === options.risk_level);
    }
    if (options.decision) {
      filtered = filtered.filter(e => e.decision === options.decision);
    }
    if (options.from) {
      filtered = filtered.filter(e => e.timestamp >= options.from!);
    }
    if (options.to) {
      filtered = filtered.filter(e => e.timestamp <= options.to!);
    }

    const total = filtered.length;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    const page = filtered.slice(offset, offset + limit);

    return {
      events: page,
      total,
      chain_valid: this.verifyChain(),
      chain_length: this.eventCount,
    };
  }

  /**
   * Verify the integrity of the entire hash chain.
   *
   * Recomputes each event's hash and checks that:
   * 1. Each event's hash matches its computed hash
   * 2. Each event's previous_event_hash matches the prior event's hash
   */
  verifyChain(): boolean {
    let previousHash: string | null = null;

    for (const event of this.events) {
      // Check previous hash link
      if (event.previous_event_hash !== previousHash) {
        return false;
      }

      // Recompute hash
      const { event_hash, ...eventWithoutHash } = event;
      const computed = this.computeHash(eventWithoutHash);
      if (computed !== event_hash) {
        return false;
      }

      previousHash = event_hash;
    }

    return true;
  }

  /**
   * Get the total number of audit events.
   */
  getEventCount(): number {
    return this.eventCount;
  }

  /**
   * Get the hash of the last event (for chain verification).
   */
  getLastHash(): string | null {
    return this.lastEventHash;
  }
}
