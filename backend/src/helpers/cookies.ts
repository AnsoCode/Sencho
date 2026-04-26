import type { Request } from 'express';
import { SESSION_COOKIE_MAX_AGE_MS } from './constants';

/** True when the request arrived over HTTPS, either directly or via a trusted TLS-terminating proxy. */
export const isSecureRequest = (req: Request): boolean => {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
};

/** Cookie options derived from the current request (secure flag follows the connection). */
export const getCookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: isSecureRequest(req),
  sameSite: 'strict' as const,
  maxAge: SESSION_COOKIE_MAX_AGE_MS,
});
