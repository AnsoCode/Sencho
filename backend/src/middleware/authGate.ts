import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { DatabaseService } from '../services/DatabaseService';
import { isDebugEnabled } from '../utils/debug';
import { getAuditSummary } from '../utils/audit-summaries';
import { WEBHOOK_TRIGGER_RE } from '../helpers/routePatterns';

/**
 * Build the `/api/*` auth gate. Mounted at `/api`, so paths it sees are
 * already stripped of the `/api` prefix. Exempts `/auth/*` (setup, login,
 * SSO: handled by their own routes) and webhook triggers (authenticated
 * via HMAC, not session).
 *
 * Takes `authMiddleware` as a dependency instead of importing it so this
 * file does not pin the monolith's auth lifecycle. Phase 2 extracts
 * `authMiddleware` into its own module.
 */
export function createAuthGate(authMiddleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith('/auth/') || WEBHOOK_TRIGGER_RE.test(req.path)) {
      next();
      return;
    }
    authMiddleware(req, res, next);
  };
}

/**
 * Audit-logging middleware. Records every mutating `/api/*` action for
 * Admiral accountability. Mounted at `/api`. Uses `res.on('finish')` to
 * capture the final status code.
 */
export const auditLog: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    next();
    return;
  }

  const username = req.user?.username || 'unknown';
  const nodeId = req.nodeId ?? null;
  const forwarded = req.headers['x-forwarded-for'];
  const xff = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const ip = req.ip || xff || '';
  const apiPath = req.path;

  res.on('finish', () => {
    try {
      if (isDebugEnabled()) {
        console.log(`[Audit:diag] ${req.method} /api${apiPath} by=${username} status=${res.statusCode} node=${nodeId ?? 'local'} ip=${ip}`);
      }
      DatabaseService.getInstance().insertAuditLog({
        timestamp: Date.now(),
        username,
        method: req.method,
        path: `/api${apiPath}`,
        status_code: res.statusCode,
        node_id: nodeId,
        ip_address: ip,
        summary: getAuditSummary(req.method, apiPath),
      });
    } catch (err) {
      console.error('[Audit] Failed to write audit log:', err);
    }
  });

  next();
};
