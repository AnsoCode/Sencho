import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { getErrorMessage } from '../utils/errors';

interface HttpError {
  status?: number;
  statusCode?: number;
  expose?: boolean;
  message?: string;
}

/**
 * Central Express error handler. Preserves the status + message of HTTP errors
 * thrown by upstream middleware (body-parser's 413 `PayloadTooLargeError`,
 * CORS 403s, etc.) when the error is safe to expose; otherwise returns a
 * generic 500. Mounted last so Express recognises the 4-argument signature.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
  console.error('[Error]', err);
  if (res.headersSent) {
    next(err);
    return;
  }
  const e = (err ?? {}) as HttpError;
  const status = e.statusCode ?? e.status ?? 500;
  const expose = e.expose === true || status < 500;
  const message = expose ? getErrorMessage(err, 'Request failed') : 'Internal server error';
  res.status(status).json({ error: message });
};
