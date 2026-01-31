/**
 * ACP Middleware — Express and MCP middleware for consent gates.
 */

import type {
  ActionCategory,
  ConsentResponse,
  RiskLevel,
  RequestConsentOptions,
} from './types.js';
import { ACPClient, ConsentDeniedError } from './client.js';

// ─── Express Middleware ─────────────────────────────────────────────

export interface ExpressConsentOptions {
  client: ACPClient;
  /** Map route patterns to risk levels */
  routes?: Record<string, { risk_level: RiskLevel; category?: ActionCategory; description?: string }>;
  /** Default risk level for unmatched routes */
  defaultRiskLevel?: RiskLevel;
  /** Skip consent for these methods */
  safeMethods?: string[];
  /** Custom function to extract action info from request */
  extractAction?: (req: any) => RequestConsentOptions | null;
}

/**
 * Express middleware that requires consent for matching requests.
 *
 * Usage:
 *   app.use('/api/dangerous', acpExpressMiddleware({
 *     client: new ACPClient({ agentId: 'my-api' }),
 *     defaultRiskLevel: 'high',
 *   }));
 */
export function acpExpressMiddleware(options: ExpressConsentOptions) {
  const safeMethods = new Set((options.safeMethods || ['GET', 'HEAD', 'OPTIONS']).map(m => m.toUpperCase()));

  return async (req: any, res: any, next: any) => {
    // Skip safe methods
    if (safeMethods.has(req.method.toUpperCase())) {
      return next();
    }

    // Extract action info
    let actionOpts: RequestConsentOptions | null = null;

    if (options.extractAction) {
      actionOpts = options.extractAction(req);
    }

    if (!actionOpts) {
      // Try to match route config
      const routeConfig = options.routes?.[req.path] || options.routes?.[req.route?.path];
      actionOpts = {
        tool: `${req.method} ${req.path}`,
        description: routeConfig?.description || `${req.method} request to ${req.path}`,
        parameters: { body: req.body, query: req.query },
        risk_level: routeConfig?.risk_level || options.defaultRiskLevel || 'medium',
        category: routeConfig?.category,
      };
    }

    try {
      const response = await options.client.requestConsent(actionOpts);

      if (response.decision === 'approved' || response.decision === 'approved_with_modifications') {
        // Attach consent proof to request for downstream use
        (req as any).acpConsent = response;
        return next();
      }

      res.status(403).json({
        error: 'Consent Denied',
        message: `Human reviewer denied this action: ${response.reason || 'No reason given'}`,
        request_id: response.request_id,
      });
    } catch (err) {
      if (err instanceof ConsentDeniedError) {
        res.status(403).json({
          error: 'Consent Denied',
          message: err.message,
        });
      } else {
        next(err);
      }
    }
  };
}

// ─── MCP Tool Wrapper ───────────────────────────────────────────────

export interface MCPConsentOptions {
  client: ACPClient;
  /** Risk level overrides per tool name */
  toolRiskLevels?: Record<string, RiskLevel>;
  /** Default risk level */
  defaultRiskLevel?: RiskLevel;
}

/**
 * Wrap an MCP tool handler with ACP consent.
 *
 * Usage:
 *   const handler = acpMCPToolWrapper(
 *     originalHandler,
 *     {
 *       client: new ACPClient({ agentId: 'mcp-server' }),
 *       toolRiskLevels: { send_email: 'high', delete_file: 'critical' },
 *     }
 *   );
 */
export function acpMCPToolWrapper(
  toolName: string,
  handler: (params: Record<string, unknown>) => Promise<any>,
  options: MCPConsentOptions
): (params: Record<string, unknown>) => Promise<any> {
  const riskLevel = options.toolRiskLevels?.[toolName] || options.defaultRiskLevel || 'medium';

  return async (params: Record<string, unknown>) => {
    const response = await options.client.requestConsent({
      tool: toolName,
      description: `MCP tool call: ${toolName}`,
      parameters: params,
      risk_level: riskLevel,
    });

    if (response.decision === 'approved' || response.decision === 'approved_with_modifications') {
      // Apply modifications if any
      const finalParams = response.modifications
        ? { ...params, ...response.modifications }
        : params;
      return handler(finalParams);
    }

    throw new ConsentDeniedError(
      `Consent denied for MCP tool ${toolName}`,
      response
    );
  };
}

/**
 * Wrap all tools in an MCP server with consent gates.
 *
 * Usage:
 *   const wrappedTools = acpWrapMCPTools(originalTools, {
 *     client: new ACPClient({ agentId: 'mcp-server' }),
 *     toolRiskLevels: { send_email: 'high' },
 *   });
 */
export function acpWrapMCPTools(
  tools: Record<string, { handler: (params: any) => Promise<any>; description?: string }>,
  options: MCPConsentOptions
): Record<string, { handler: (params: any) => Promise<any>; description?: string }> {
  const wrapped: Record<string, { handler: (params: any) => Promise<any>; description?: string }> = {};

  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = {
      ...tool,
      handler: acpMCPToolWrapper(name, tool.handler, options),
    };
  }

  return wrapped;
}
