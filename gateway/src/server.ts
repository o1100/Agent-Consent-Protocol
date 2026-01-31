/**
 * ACP Gateway — REST API Server
 *
 * Express-based REST API for the Agent Consent Protocol.
 * Handles consent request lifecycle, policy management, and audit queries.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import type {
  ConsentRequest,
  ConsentResponse,
  CreateConsentRequestBody,
  RespondToConsentBody,
  ChannelAdapter,
  PolicyEvaluation,
} from './types.js';
import { ConsentStore } from './consent-store.js';
import { PolicyEngine } from './policy-engine.js';
import { AuditTrail } from './audit.js';
import {
  generateNonce,
  generateRequestId,
  createConsentProof,
  generateKeyPair,
} from './crypto.js';

export interface GatewayConfig {
  /** Port to listen on (default: 3000) */
  port: number;
  /** Path to SQLite database (default: :memory:) */
  dbPath: string;
  /** Path to policy JSON file */
  policyPath?: string;
  /** Path to audit log JSONL file */
  auditPath: string;
  /** API key for authentication (if set, all requests must include it) */
  apiKey?: string;
  /** Default timeout for consent requests in seconds */
  defaultTimeoutSeconds: number;
  /** Gateway signing key (hex). If not set, a new key is generated. */
  signingKeyHex?: string;
  /** Channel adapters */
  channels?: ChannelAdapter[];
}

export function createGatewayServer(config: GatewayConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ─── Dependencies ───────────────────────────────────────────────
  const store = new ConsentStore(config.dbPath);

  // Generate or load signing keys
  const keyPair = config.signingKeyHex
    ? { privateKey: config.signingKeyHex, publicKey: '' } // Will derive public from private
    : generateKeyPair();

  const policyEngine = config.policyPath
    ? new PolicyEngine(config.policyPath, store)
    : new PolicyEngine({
        type: 'policy',
        version: '0.1.0',
        id: 'policy_default',
        name: 'Default Policy',
        rules: [],
        defaults: {
          unmatched_action: 'always_ask',
          timeout_seconds: config.defaultTimeoutSeconds,
        },
      }, store);

  const audit = new AuditTrail(config.auditPath);
  const channels: Map<string, ChannelAdapter> = new Map();

  for (const ch of config.channels || []) {
    channels.set(ch.name, ch);
  }

  // ─── Auth Middleware ────────────────────────────────────────────
  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    if (!config.apiKey) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${config.apiKey}`) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing API key' });
      return;
    }
    next();
  };

  // ─── Background Tasks ──────────────────────────────────────────
  // Expire pending requests periodically
  const expirationInterval = setInterval(() => {
    const expired = store.expirePendingRequests();
    if (expired > 0) {
      console.log(`[ACP] Expired ${expired} pending consent request(s)`);
    }
  }, 30_000); // Every 30 seconds

  // ─── Health Check ──────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      channels: Array.from(channels.keys()),
    });
  });

  // ─── Consent Request Endpoints ─────────────────────────────────

  /**
   * POST /api/v1/consent/request
   * Create a new consent request.
   */
  app.post('/api/v1/consent/request', authenticate, (req: Request, res: Response): void => {
    try {
      const body = req.body as CreateConsentRequestBody;

      // Validate required fields
      if (!body.agent_id || !body.action?.tool || !body.action?.description) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required fields: agent_id, action.tool, action.description',
        });
        return;
      }

      // Classify the action
      const classification = policyEngine.classifyAction(
        body.action.tool,
        body.action.category,
        body.action.risk_level
      );

      // Build the full action info
      const action = {
        tool: body.action.tool,
        category: classification.category,
        risk_level: classification.risk_level,
        parameters: body.action.parameters || {},
        description: body.action.description,
        estimated_impact: body.action.estimated_impact,
      };

      // Evaluate policy
      const evaluation: PolicyEvaluation = policyEngine.evaluate(
        action,
        { id: body.agent_id, name: body.agent_name, framework: body.agent_framework },
        body.session_id
      );

      // Handle auto-approve
      if (evaluation.action === 'auto_approve') {
        const requestId = generateRequestId();
        const nonce = generateNonce();
        const now = new Date().toISOString();

        // Create proof for auto-approval
        const proof = createConsentProof(
          keyPair.privateKey,
          requestId,
          'approved',
          nonce,
          now,
          action.parameters,
          null,
          new Date(Date.now() + 3600_000).toISOString()
        );

        // Log audit event
        audit.record({
          event_type: 'policy_auto_approved',
          request_id: requestId,
          agent_id: body.agent_id,
          action_tool: action.tool,
          action_category: action.category,
          action_risk_level: action.risk_level,
          decision: 'approved',
          policy_evaluated: evaluation.rule_id,
          policy_result: 'auto_approve',
        });

        res.status(200).json({
          request_id: requestId,
          status: 'approved',
          decision: 'approved',
          reason: evaluation.reason,
          proof,
          auto_approved: true,
        });
        return;
      }

      // Handle never-allow
      if (evaluation.action === 'never_allow') {
        const requestId = generateRequestId();

        audit.record({
          event_type: 'policy_auto_denied',
          request_id: requestId,
          agent_id: body.agent_id,
          action_tool: action.tool,
          action_category: action.category,
          action_risk_level: action.risk_level,
          decision: 'denied',
          policy_evaluated: evaluation.rule_id,
          policy_result: 'never_allow',
        });

        res.status(403).json({
          request_id: requestId,
          status: 'denied',
          decision: 'denied',
          reason: evaluation.reason,
          auto_denied: true,
        });
        return;
      }

      // Create a pending consent request
      const requestId = generateRequestId();
      const nonce = generateNonce();
      const now = new Date();
      const timeoutSeconds = body.timeout_seconds || config.defaultTimeoutSeconds;
      const expiresAt = new Date(now.getTime() + timeoutSeconds * 1000);

      const consentRequest: ConsentRequest = {
        type: 'consent_request',
        version: '0.1.0',
        id: requestId,
        timestamp: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        agent: {
          id: body.agent_id,
          name: body.agent_name,
          framework: body.agent_framework,
          session_id: body.session_id,
        },
        action,
        context: body.context,
        nonce,
      };

      // Store the request
      store.create(consentRequest, evaluation.action);

      // Log audit event
      audit.record({
        event_type: 'consent_requested',
        request_id: requestId,
        agent_id: body.agent_id,
        action_tool: action.tool,
        action_category: action.category,
        action_risk_level: action.risk_level,
        policy_evaluated: evaluation.rule_id,
        policy_result: evaluation.action,
      });

      // Deliver to channel adapters
      for (const channel of channels.values()) {
        channel.deliverRequest(consentRequest).catch((err) => {
          console.error(`[ACP] Failed to deliver to channel ${channel.name}:`, err);
        });
      }

      res.status(201).json({
        request_id: requestId,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        poll_url: `/api/v1/consent/${requestId}`,
        policy_evaluation: {
          decision: evaluation.action,
          rule: evaluation.rule_name || evaluation.rule_id,
          reason: evaluation.reason,
        },
      });
    } catch (err) {
      console.error('[ACP] Error creating consent request:', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/consent/:id
   * Check the status of a consent request.
   */
  app.get('/api/v1/consent/:id', authenticate, (req: Request, res: Response): void => {
    const stored = store.get(req.params.id as string);

    if (!stored) {
      res.status(404).json({ error: 'Not Found', message: 'Consent request not found' });
      return;
    }

    // Check for expiration
    if (stored.status === 'pending' && new Date(stored.expires_at) < new Date()) {
      store.update(stored.id, 'expired');
      stored.status = 'expired';
    }

    res.json({
      request_id: stored.id,
      status: stored.status,
      request: stored.request,
      response: stored.response || null,
      created_at: stored.created_at,
      updated_at: stored.updated_at,
      expires_at: stored.expires_at,
    });
  });

  /**
   * POST /api/v1/consent/:id/respond
   * Submit a human response to a consent request.
   */
  app.post('/api/v1/consent/:id/respond', authenticate, (req: Request, res: Response): void => {
    try {
      const stored = store.get(req.params.id as string);

      if (!stored) {
        res.status(404).json({ error: 'Not Found', message: 'Consent request not found' });
        return;
      }

      if (stored.status !== 'pending') {
        res.status(409).json({
          error: 'Conflict',
          message: `Request is already ${stored.status}`,
        });
        return;
      }

      // Check expiration
      if (new Date(stored.expires_at) < new Date()) {
        store.update(stored.id, 'expired');
        res.status(410).json({
          error: 'Gone',
          message: 'Consent request has expired',
        });
        return;
      }

      const body = req.body as RespondToConsentBody;

      if (!body.decision || !body.approver_id) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Missing required fields: decision, approver_id',
        });
        return;
      }

      const now = new Date();
      const validUntil = new Date(stored.expires_at);

      // Create cryptographic proof
      const proof = createConsentProof(
        keyPair.privateKey,
        stored.id,
        body.decision,
        stored.request.nonce,
        now.toISOString(),
        stored.request.action.parameters,
        body.modifications || null,
        validUntil.toISOString()
      );

      // Build consent response
      const response: ConsentResponse = {
        type: 'consent_response',
        version: '0.1.0',
        request_id: stored.id,
        timestamp: now.toISOString(),
        decision: body.decision,
        approver: {
          id: body.approver_id,
          channel: body.channel || 'api',
        },
        modifications: body.modifications || null,
        conditions: {
          valid_until: validUntil.toISOString(),
          require_exact_params: true,
        },
        reason: body.reason,
        nonce: stored.request.nonce,
        proof,
      };

      // Determine status
      const status = body.decision === 'approved' || body.decision === 'approved_with_modifications'
        ? 'approved' as const
        : 'denied' as const;

      // Update store
      store.update(stored.id, status, response);

      // Record session approval if applicable
      if (status === 'approved' && stored.policy_decision === 'ask_once_per_session') {
        const sessionId = stored.request.agent.session_id;
        if (sessionId) {
          store.recordSessionApproval(sessionId, stored.request.action.tool, 3600);
        }
      }

      // Calculate response time
      const responseTimeMs = now.getTime() - new Date(stored.created_at).getTime();

      // Log audit event
      const eventType = status === 'approved' ? 'consent_approved' : 'consent_denied';
      audit.record({
        event_type: eventType,
        request_id: stored.id,
        agent_id: stored.request.agent.id,
        approver_id: body.approver_id,
        action_tool: stored.request.action.tool,
        action_category: stored.request.action.category,
        action_risk_level: stored.request.action.risk_level,
        decision: body.decision,
        response_time_ms: responseTimeMs,
        metadata: { channel: body.channel },
      });

      res.json({
        request_id: stored.id,
        status,
        response,
      });
    } catch (err) {
      console.error('[ACP] Error responding to consent request:', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  });

  /**
   * GET /api/v1/consent/:id/proof
   * Get the cryptographic proof for an approved consent request.
   */
  app.get('/api/v1/consent/:id/proof', authenticate, (req: Request, res: Response): void => {
    const stored = store.get(req.params.id as string);

    if (!stored) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }

    if (!stored.response?.proof) {
      res.status(404).json({
        error: 'Not Found',
        message: 'No proof available — request may not have been responded to yet',
      });
      return;
    }

    res.json({
      request_id: stored.id,
      status: stored.status,
      proof: stored.response.proof,
      valid_until: stored.response.conditions.valid_until,
    });
  });

  // ─── Audit Trail Endpoints ─────────────────────────────────────

  /**
   * GET /api/v1/audit
   * Query the audit trail.
   */
  app.get('/api/v1/audit', authenticate, (req: Request, res: Response): void => {
    const result = audit.query({
      request_id: req.query.request_id as string,
      agent_id: req.query.agent_id as string,
      approver_id: req.query.approver_id as string,
      event_type: req.query.event_type as any,
      action_category: req.query.action_category as any,
      risk_level: req.query.risk_level as any,
      decision: req.query.decision as string,
      from: req.query.from as string,
      to: req.query.to as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    });

    res.json(result);
  });

  /**
   * GET /api/v1/audit/verify
   * Verify the integrity of the audit trail hash chain.
   */
  app.get('/api/v1/audit/verify', authenticate, (_req: Request, res: Response): void => {
    const isValid = audit.verifyChain();
    res.json({
      chain_valid: isValid,
      chain_length: audit.getEventCount(),
      last_hash: audit.getLastHash(),
    });
  });

  // ─── Policy Endpoints ──────────────────────────────────────────

  /**
   * GET /api/v1/policies
   * Get the current policy.
   */
  app.get('/api/v1/policies', authenticate, (_req: Request, res: Response): void => {
    res.json(policyEngine.getPolicy());
  });

  /**
   * PUT /api/v1/policies
   * Update the policy.
   */
  app.put('/api/v1/policies', authenticate, (req: Request, res: Response): void => {
    try {
      const policy = req.body;

      if (!policy.type || policy.type !== 'policy') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid policy format — type must be "policy"',
        });
        return;
      }

      policyEngine.updatePolicy(policy);
      res.json({ status: 'updated', policy: policyEngine.getPolicy() });
    } catch (err) {
      res.status(400).json({
        error: 'Bad Request',
        message: (err as Error).message,
      });
    }
  });

  // ─── Error Handler ─────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[ACP] Unhandled error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  });

  // ─── Cleanup ───────────────────────────────────────────────────

  const cleanup = () => {
    clearInterval(expirationInterval);
    store.close();
  };

  return { app, store, policyEngine, audit, channels, keyPair, cleanup };
}
