import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { NodeRegistry } from '../services/NodeRegistry';
import { DatabaseService } from '../services/DatabaseService';
import { isProxyExemptPath } from '../helpers/proxyExemptPaths';

/**
 * Resolve `req.nodeId` from the `x-node-id` header, `?nodeId=` query param,
 * or the default node. Returns 404 for requests targeting a deleted node so
 * downstream handlers don't fail with obscure errors.
 *
 * `/api/nodes` is intentionally exempt so the frontend can re-sync after a
 * node is deleted (otherwise a stale `x-node-id` in localStorage triggers an
 * unrecoverable 404 loop).
 */
export const nodeContextMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const nodeIdHeader = req.headers['x-node-id'] as string;
  const nodeIdQuery = req.query.nodeId as string;
  if (nodeIdHeader) {
    req.nodeId = parseInt(nodeIdHeader, 10);
  } else if (nodeIdQuery) {
    req.nodeId = parseInt(nodeIdQuery, 10);
  } else {
    req.nodeId = NodeRegistry.getInstance().getDefaultNodeId();
  }

  if (req.path.startsWith('/api/') && !isProxyExemptPath(req.path)) {
    const node = DatabaseService.getInstance().getNode(req.nodeId);
    if (!node) {
      res.status(404).json({ error: `Node with id ${req.nodeId} not found or was deleted.` });
      return;
    }
  }

  next();
};
