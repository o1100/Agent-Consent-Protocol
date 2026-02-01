/**
 * Interception Types
 *
 * Shared types for all interception kinds: MCP, shell, HTTP, file, and hook.
 * These are used by the /acp/intercept endpoint, shell wrappers,
 * HTTP proxy, and Claude Code hooks.
 */

export type InterceptionKind = 'mcp' | 'shell' | 'http' | 'file' | 'hook';

export interface InterceptionRequest {
  kind: InterceptionKind;
  tool: string;
  arguments: Record<string, unknown>;
  requestId?: string;
  rawRequest?: unknown;
}

export interface InterceptionResponse {
  allowed: boolean;
  reason?: string;
  consentProof?: {
    consent_id: string;
    signature: string;
    timestamp: string;
  };
}
