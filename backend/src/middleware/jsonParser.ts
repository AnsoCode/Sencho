import express, { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { NodeRegistry } from '../services/NodeRegistry';
import { isProxyExemptPath } from '../helpers/proxyExemptPaths';

// JSON body parser that also captures the raw bytes for HMAC verification.
// `rawBody` is part of the Express.Request augmentation (see types/express.ts);
// the cast is required because body-parser's `verify` signature types `req` as
// Node's IncomingMessage, not Express's Request.
const jsonParser = express.json({
  verify: (req, _res, buf) => {
    (req as unknown as Request).rawBody = buf;
  },
});

/**
 * Parse JSON on local requests but preserve the raw stream for remote proxy
 * forwarding.
 *
 * `express.json()` drains the IncomingMessage into `req.body`. `http-proxy`
 * then tries to pipe the already-ended stream to the upstream Sencho; Node
 * schedules the destination `.end()` on `process.nextTick`, which fires before
 * the `proxyReq` socket event, so any attempt to write the body later errors
 * with "write after end" and the request hangs. Skipping JSON parsing for
 * remote-targeted `/api/` paths keeps the stream intact.
 */
export const conditionalJsonParser: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const nodeIdHeader = req.headers['x-node-id'];
  if (nodeIdHeader) {
    const nodeId = parseInt(nodeIdHeader as string, 10);
    const node = NodeRegistry.getInstance().getNode(nodeId);
    if (node?.type === 'remote' && req.path.startsWith('/api/') && !isProxyExemptPath(req.path)) {
      next();
      return;
    }
  }
  jsonParser(req, res, next);
};
