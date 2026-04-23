import jwt from 'jsonwebtoken';
import { DatabaseService } from '../services/DatabaseService';

/**
 * Console session token lifetime. Short on purpose: these tokens are only
 * used to bridge an already-authenticated HTTP request into a WebSocket
 * upgrade, and each one is consumed by a single `wss:ws(target)` call.
 */
const CONSOLE_SESSION_TTL_SECONDS = 60;
const CONSOLE_SESSION_SCOPE = 'console_session';

export interface ConsoleSessionClaims {
  scope: typeof CONSOLE_SESSION_SCOPE;
  username?: string;
}

/**
 * Mint a short-lived JWT that grants interactive console access on the remote
 * instance without leaking the long-lived node api_token onto a
 * machine-to-machine WebSocket. Throws if the JWT secret is not configured.
 */
export function mintConsoleSession(username?: string): string {
  const jwtSecret = DatabaseService.getInstance().getGlobalSettings().auth_jwt_secret;
  if (!jwtSecret) throw new Error('No JWT secret configured');
  const payload: ConsoleSessionClaims = username
    ? { scope: CONSOLE_SESSION_SCOPE, username }
    : { scope: CONSOLE_SESSION_SCOPE };
  return jwt.sign(payload, jwtSecret, { expiresIn: CONSOLE_SESSION_TTL_SECONDS });
}

/** True when `decoded.scope` is the console_session scope. */
export function isConsoleSessionScope(scope: unknown): boolean {
  return scope === CONSOLE_SESSION_SCOPE;
}

export { CONSOLE_SESSION_SCOPE };
