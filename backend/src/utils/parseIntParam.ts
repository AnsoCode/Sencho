import type { Request, Response } from 'express';

/**
 * Parse a numeric route param. Writes a 400 response and returns null when
 * the value isn't a valid integer; callers early-return on null.
 *
 * @param paramName the key in req.params (e.g. 'id', 'nodeId')
 * @param label optional human-readable label used in the error body.
 *   Falls back to paramName when omitted (e.g. 'Invalid id').
 */
export function parseIntParam(
  req: Request,
  res: Response,
  paramName: string,
  label?: string,
): number | null {
  const raw = req.params[paramName] as string | undefined;
  const parsed = parseInt(raw ?? '', 10);
  if (isNaN(parsed)) {
    res.status(400).json({ error: `Invalid ${label ?? paramName}` });
    return null;
  }
  return parsed;
}
