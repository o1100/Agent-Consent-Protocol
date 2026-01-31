/**
 * ACP Gateway — Consent Request Storage
 *
 * SQLite-backed storage for consent requests using better-sqlite3.
 * Provides fast, synchronous reads and ACID-compliant writes.
 */

import Database from 'better-sqlite3';
import type {
  ConsentRequest,
  ConsentResponse,
  ConsentStatus,
  StoredConsentRequest,
} from './types.js';

export class ConsentStore {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  /**
   * Create the database schema if it doesn't exist.
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consent_requests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        request_json TEXT NOT NULL,
        response_json TEXT,
        policy_decision TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_consent_status ON consent_requests(status);
      CREATE INDEX IF NOT EXISTS idx_consent_expires ON consent_requests(expires_at);
      CREATE INDEX IF NOT EXISTS idx_consent_created ON consent_requests(created_at);

      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        used_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_approvals (
        session_id TEXT NOT NULL,
        tool_pattern TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (session_id, tool_pattern)
      );
    `);
  }

  /**
   * Store a new consent request.
   */
  create(request: ConsentRequest, policyDecision?: string): StoredConsentRequest {
    const now = new Date().toISOString();
    const stored: StoredConsentRequest = {
      id: request.id,
      status: 'pending',
      request,
      created_at: now,
      updated_at: now,
      expires_at: request.expires_at,
      policy_decision: policyDecision as any,
    };

    const stmt = this.db.prepare(`
      INSERT INTO consent_requests (id, status, request_json, policy_decision, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      stored.id,
      stored.status,
      JSON.stringify(stored.request),
      stored.policy_decision ?? null,
      stored.created_at,
      stored.updated_at,
      stored.expires_at
    );

    // Register the nonce
    this.db.prepare(
      'INSERT INTO used_nonces (nonce, request_id, used_at) VALUES (?, ?, ?)'
    ).run(request.nonce, request.id, now);

    return stored;
  }

  /**
   * Get a consent request by ID.
   */
  get(id: string): StoredConsentRequest | null {
    const row = this.db.prepare(
      'SELECT * FROM consent_requests WHERE id = ?'
    ).get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      status: row.status as ConsentStatus,
      request: JSON.parse(row.request_json),
      response: row.response_json ? JSON.parse(row.response_json) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      policy_decision: row.policy_decision,
    };
  }

  /**
   * Update the status and optionally the response of a consent request.
   */
  update(
    id: string,
    status: ConsentStatus,
    response?: ConsentResponse
  ): StoredConsentRequest | null {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE consent_requests
      SET status = ?, response_json = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, response ? JSON.stringify(response) : null, now, id);

    return this.get(id);
  }

  /**
   * List consent requests with optional filtering.
   */
  list(options: {
    status?: ConsentStatus;
    agent_id?: string;
    limit?: number;
    offset?: number;
  } = {}): { requests: StoredConsentRequest[]; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.agent_id) {
      conditions.push("json_extract(request_json, '$.agent.id') = ?");
      params.push(options.agent_id);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const total = (this.db.prepare(
      `SELECT COUNT(*) as count FROM consent_requests ${where}`
    ).get(...params) as any).count;

    const rows = this.db.prepare(
      `SELECT * FROM consent_requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    const requests = rows.map((row: any) => ({
      id: row.id,
      status: row.status as ConsentStatus,
      request: JSON.parse(row.request_json),
      response: row.response_json ? JSON.parse(row.response_json) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
      policy_decision: row.policy_decision,
    }));

    return { requests, total };
  }

  /**
   * Check if a nonce has been used (replay prevention).
   */
  isNonceUsed(nonce: string): boolean {
    const row = this.db.prepare(
      'SELECT 1 FROM used_nonces WHERE nonce = ?'
    ).get(nonce);
    return !!row;
  }

  /**
   * Expire all pending requests that have passed their expiration time.
   * Returns the number of expired requests.
   */
  expirePendingRequests(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE consent_requests
      SET status = 'expired', updated_at = ?
      WHERE status = 'pending' AND expires_at < ?
    `).run(now, now);

    return result.changes;
  }

  /**
   * Record a session-scoped approval for "ask_once_per_session" policies.
   */
  recordSessionApproval(
    sessionId: string,
    toolPattern: string,
    durationSeconds: number
  ): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);

    this.db.prepare(`
      INSERT OR REPLACE INTO session_approvals (session_id, tool_pattern, approved_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, toolPattern, now.toISOString(), expiresAt.toISOString());
  }

  /**
   * Check if a session has a valid approval for a tool pattern.
   */
  hasSessionApproval(sessionId: string, toolPattern: string): boolean {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      SELECT 1 FROM session_approvals
      WHERE session_id = ? AND tool_pattern = ? AND expires_at > ?
    `).get(sessionId, toolPattern, now);

    return !!row;
  }

  /**
   * Get count of actions by category within a time window (for rate limiting).
   */
  getActionCount(
    category: string,
    windowSeconds: number,
    agentId?: string
  ): number {
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const conditions = [
      "json_extract(request_json, '$.action.category') = ?",
      "created_at > ?",
      "status IN ('approved', 'executed')"
    ];
    const params: unknown[] = [category, since];

    if (agentId) {
      conditions.push("json_extract(request_json, '$.agent.id') = ?");
      params.push(agentId);
    }

    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM consent_requests WHERE ${conditions.join(' AND ')}`
    ).get(...params) as any;

    return row.count;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
