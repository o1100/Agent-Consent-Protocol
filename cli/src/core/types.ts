/**
 * Core Types — Action, Verdict, PolicyRule
 *
 * These are the fundamental types of the ACP protocol.
 * An Action describes what the agent wants to do.
 * A Verdict is the gate's decision: allow or deny.
 * PolicyRule defines a single rule in the policy YAML.
 */

export type ActionKind = 'shell' | 'http';

export interface Action {
  name: string;
  args?: string;
  meta: {
    kind: ActionKind;
    host?: string;
    method?: string;
    port?: number;
  };
}

export interface Verdict {
  decision: 'allow' | 'deny';
  reason: string;
}

export interface PolicyRule {
  match?: {
    name?: string;
    args?: string;
    kind?: ActionKind;
    host?: string;
    method?: string;
  };
  action: 'allow' | 'ask' | 'deny';
  timeout?: number;
}

export interface PolicyConfig {
  default: 'allow' | 'ask' | 'deny';
  wrap: string[];
  rules: PolicyRule[];
}

export interface AuditEntry {
  timestamp: string;
  action: Action;
  verdict: Verdict;
}
