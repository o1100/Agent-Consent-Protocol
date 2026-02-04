/**
 * AuditLog — append-only JSONL
 *
 * Every consent decision is logged as a single JSON line.
 * No hash chains, no cryptographic proofs — simple and auditable.
 */

import fs from 'node:fs';
import type { Action, Verdict, AuditEntry } from './types.js';

export interface AuditLog {
  append(action: Action, verdict: Verdict): void;
}

export class FileAuditLog implements AuditLog {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
  }

  append(action: Action, verdict: Verdict): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      verdict,
    };
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
  }
}
