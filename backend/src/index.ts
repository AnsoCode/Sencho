import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import WebSocket, { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import DockerController, { globalDockerNetwork, type CreateNetworkOptions, type NetworkDriver } from './services/DockerController';
import type Dockerode from 'dockerode';
import { FileSystemService } from './services/FileSystemService';
import { ComposeService } from './services/ComposeService';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore - composerize lacks proper type definitions
import composerize from 'composerize';
import si from 'systeminformation';
import http from 'http';
import httpProxy from 'http-proxy';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { HostTerminalService } from './services/HostTerminalService';
import { DatabaseService, Node, AuthProvider, ScheduledTask, UserRole, ResourceType } from './services/DatabaseService';
import { NotificationService } from './services/NotificationService';
import { MonitorService } from './services/MonitorService';
import { DockerEventManager } from './services/DockerEventManager';
import { ImageUpdateService } from './services/ImageUpdateService';
import { templateService } from './services/TemplateService';
import { ErrorParser } from './utils/ErrorParser';
import { NodeRegistry } from './services/NodeRegistry';
import { LicenseService, type LicenseTier, type LicenseVariant, isLicenseTier, isLicenseVariant, normalizeTier, normalizeVariant, PROXY_TIER_HEADER, PROXY_VARIANT_HEADER } from './services/LicenseService';
import { WebhookService } from './services/WebhookService';
import { SSOService } from './services/SSOService';
import { SchedulerService } from './services/SchedulerService';
import { RegistryService } from './services/RegistryService';
import { CacheService } from './services/CacheService';
import { CAPABILITIES, getSenchoVersion, isValidVersion, fetchRemoteMeta, getActiveCapabilities, type RemoteMeta } from './services/CapabilityRegistry';
import { GitSourceService, GitSourceError, sweepStaleTempDirs as sweepStaleGitTempDirs, type GitSourceErrorCode } from './services/GitSourceService';

// ── Hot-path cache TTLs ────────────────────────────────────────────────
// Short TTLs collapse concurrent polling pressure across browser tabs and
// overlapping service samplers without introducing noticeable UI staleness.
// Keys are per-node: "stats:<nodeId>", "system-stats:<nodeId>", "stack-statuses:<nodeId>".
const STATS_CACHE_TTL_MS = 2_000;
const SYSTEM_STATS_CACHE_TTL_MS = 3_000;
const STACK_STATUSES_CACHE_TTL_MS = 3_000;

/**
 * Invalidate the per-node caches affected by a stack/container mutation so
 * the next dashboard poll shows fresh state instead of stale reads. Called
 * from every endpoint that changes the Docker or filesystem state.
 *
 * Also drops the global `project-name-map` since stack writes (create, delete,
 * rename, compose edits) can reshape the on-disk layout used to build it.
 */
function invalidateNodeCaches(nodeId: number): void {
  const cache = CacheService.getInstance();
  cache.invalidate(`stats:${nodeId}`);
  cache.invalidate(`stack-statuses:${nodeId}`);
  cache.invalidate('project-name-map');
}

import { isDebugEnabled } from './utils/debug';
import { getLatestVersion } from './utils/version-check';
import { getErrorMessage } from './utils/errors';
import { captureLocalNodeFiles, captureRemoteNodeFiles, SnapshotNodeData } from './utils/snapshot-capture';
import { GlobalLogEntry, normalizeContainerName, parseLogTimestamp, detectLogLevel, demuxDockerLog } from './utils/log-parsing';
import SelfUpdateService from './services/SelfUpdateService';
import semver from 'semver';
import { CronExpressionParser } from 'cron-parser';
import { isValidStackName, isValidRemoteUrl, isPathWithinBase, isValidCidr, isValidIPv4, isValidDockerResourceId } from './utils/validation';
import YAML from 'yaml';
import { promises as fsPromises } from 'fs';

// Suppress [DEP0060] DeprecationWarning emitted by http-proxy@1.18.1 which calls
// util._extend internally. The warning fires at runtime when createProxyServer() is
// first invoked (NOT at import time), so intercepting process.emitWarning here -
// before the proxy instances are created below - fully prevents it.
// http-proxy has no compatible update; this suppression is intentional and safe.
const _origEmitWarning = process.emitWarning.bind(process);
(process as any).emitWarning = (warning: any, ...args: any[]) => {
  const code = typeof args[0] === 'object' ? args[0]?.code : args[1];
  if (code === 'DEP0060') return;
  _origEmitWarning(warning, ...args);
};

const MIN_PASSWORD_LENGTH = 8;
const VALID_LABEL_COLORS = ['teal', 'blue', 'purple', 'rose', 'amber', 'green', 'orange', 'pink', 'cyan', 'slate'] as const;
const MAX_LABELS_PER_NODE = 50;
const app = express();
const PORT = 3000;

// FileSystemService and ComposeService are instantiated per-request via .getInstance(nodeId)

// Cookie settings
const COOKIE_NAME = 'sencho_token';

// Helper to determine if request is secure (HTTPS or behind a proxy that terminates SSL)
const isSecureRequest = (req: Request): boolean => {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
};

// Helper to get cookie options dynamically per-request
const getCookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: isSecureRequest(req),
  sameSite: 'strict' as const,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

// Middleware

// Trust the first reverse proxy (nginx, Traefik, etc.) for correct req.protocol,
// req.ip, and secure cookie detection behind a proxy.
app.set('trust proxy', 1);

// Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
// crossOriginEmbedderPolicy: disabled - Monaco editor workers lack COEP headers.
// hsts: disabled - HSTS must only be set when the app is served over HTTPS.
//   Enabling it over HTTP permanently breaks browser access for 1 year.
// contentSecurityPolicy.upgradeInsecureRequests: explicitly set to null.
//   Helmet 8 merges custom directives with its defaults, which include this
//   directive. It tells browsers to silently upgrade all HTTP sub-resource fetches
//   to HTTPS. On a plain-HTTP self-hosted deployment (the common case) this causes
//   every JS/CSS asset to fail with ERR_SSL_PROTOCOL_ERROR, producing a blank page.
//   Setting null is the Helmet 8 API to remove a default directive.
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  // COOP is only meaningful over HTTPS. Over HTTP the browser logs a warning
  // and ignores it, creating noise in the console with no security benefit.
  crossOriginOpenerPolicy: false,
  // Origin-Agent-Cluster is only meaningful over HTTPS. Over plain HTTP the
  // browser logs a warning and ignores it. Disabling removes console noise.
  originAgentCluster: false,
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      // img-src: 'https:' is required for App Store template icons hosted on
      // external registries (e.g. raw.githubusercontent.com).
      imgSrc: ["'self'", 'data:', 'https:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      // connect-src: explicit 'self' covers same-origin fetch/XHR/WebSocket.
      // ws: and wss: are included for WebSocket connections in any scheme context.
      connectSrc: ["'self'", 'ws:', 'wss:'],
      // worker-src: Monaco editor creates Web Workers via blob: URLs for language
      // services (syntax highlighting, intellisense). Without blob: they silently fail.
      workerSrc: ["'self'", 'blob:'],
      // Helmet 8 merges custom directives with its defaults, which include
      // upgrade-insecure-requests. Setting it to null explicitly removes it.
      // On plain-HTTP self-hosted deployments (the common case) this directive
      // causes every JS/CSS asset to fail with ERR_SSL_PROTOCOL_ERROR → blank page.
      upgradeInsecureRequests: null,
    },
  },
}));

// CORS - in production restrict to the configured frontend origin.
// In development, mirror the request origin so Vite's dev server works.
const corsOrigin = process.env.NODE_ENV === 'production'
  ? (process.env.FRONTEND_URL || false)
  : true;

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));

// Gzip JSON and HTML responses. SSE streams (Content-Type: text/event-stream)
// MUST NOT be compressed because compression buffers output and would delay
// event delivery until a flush, breaking live log and status streams.
app.use(compression({
  filter: (req: Request, res: Response) => {
    const ct = res.getHeader('Content-Type');
    if (typeof ct === 'string' && ct.includes('text/event-stream')) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

// Cookie parser must run before rate limiters so the hybrid key generator
// can read req.cookies for per-user rate limit bucketing.
app.use(cookieParser());

// ── Rate Limiting ─────────────────────────────────────────────────────────────
//
// Tiered rate limiting to prevent UX lockouts while maintaining security:
//   Tier 0/1 (Polling):  High-frequency GET endpoints exempt from global limit,
//                         with a 300/min safety net to prevent resource exhaustion.
//   Tier W   (Webhooks): CI/CD webhook triggers at 500/min (shared datacenter IPs).
//   Tier 2   (Standard): All other endpoints at 200/min (raised from 100).
//   Tier 3   (Auth):     Strict brute-force protection (5-10 attempts / 15min).
//
// Enterprise adaptations:
//   - Internal node-to-node traffic (node_proxy JWTs) bypasses all rate limiters.
//   - Authenticated requests are keyed by user ID (not IP) to prevent shared
//     NAT/VPN environments from pooling rate limit budgets.

/** Read-only GET endpoints polled at high frequency by the dashboard/fleet UI. */
const POLLING_EXEMPT_PATHS = new Set([
  '/meta', '/health', '/stats', '/system/stats',
  '/stacks/statuses', '/metrics/historical',
  '/auth/status', '/auth/sso/providers', '/license',
]);

const WEBHOOK_TRIGGER_RE = /^\/webhooks\/\d+\/trigger$/;

/**
 * Returns true if the request bears a node_proxy Bearer token.
 * Uses jwt.decode() (no signature verification) to avoid crypto overhead on the
 * hot path; authMiddleware performs full verification downstream. Worst case for
 * a forged token: it skips the rate limiter but is still rejected by auth.
 * Result is memoized on the request object so the two sequential limiters
 * don't repeat the work.
 */
function isNodeProxyRequest(req: Request): boolean {
  const cached = (req as any)._isNodeProxy;
  if (cached !== undefined) return cached;
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    (req as any)._isNodeProxy = false;
    return false;
  }
  try {
    const decoded = jwt.decode(auth.slice(7)) as { scope?: string } | null;
    const result = decoded?.scope === 'node_proxy';
    (req as any)._isNodeProxy = result;
    return result;
  } catch {
    (req as any)._isNodeProxy = false;
    return false;
  }
}

/**
 * Hybrid rate limit key: uses the JWT username/sub claim for authenticated
 * requests (per-user budgets) and falls back to IP for unauthenticated ones.
 * Uses jwt.decode() (no verification) to avoid double-verification cost;
 * authMiddleware handles signature checks downstream.
 */
function rateLimitKeyGenerator(req: Request): string {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) {
    try {
      const decoded = jwt.decode(cookie) as { username?: string } | null;
      if (decoded?.username) return `user:${decoded.username}`;
    } catch { /* fall through to IP */ }
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.decode(auth.slice(7)) as { username?: string; sub?: string } | null;
      if (decoded?.username) return `user:${decoded.username}`;
      if (decoded?.sub) return `user:${decoded.sub}`;
    } catch { /* fall through to IP */ }
  }
  return ipKeyGenerator(req.ip || 'unknown');
}

/** Shared config for all rate limiters (1-minute window, standard headers). */
const rateLimitBase = {
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
} as const;

// Tier 2: Global API rate limiter. Skips polling endpoints (Tier 0/1), webhook
// triggers (Tier W), and internal node-to-node traffic (node_proxy).
const globalApiLimiter = rateLimit({
  ...rateLimitBase,
  max: process.env.NODE_ENV === 'production'
    ? parseInt(process.env.API_RATE_LIMIT || '200', 10)
    : 1000,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Too many requests. Please try again shortly.' },
  skip: (req: Request) => {
    if (req.method === 'GET' && POLLING_EXEMPT_PATHS.has(req.path)) return true;
    if (req.method === 'POST' && WEBHOOK_TRIGGER_RE.test(req.path)) return true;
    if (isNodeProxyRequest(req)) return true;
    return false;
  },
});

app.use('/api/', globalApiLimiter);

// Tier 0/1: Polling safety net. Applies only to polling-exempt endpoints to
// prevent resource exhaustion from runaway or malicious polling.
const pollingLimiter = rateLimit({
  ...rateLimitBase,
  max: process.env.NODE_ENV === 'production'
    ? parseInt(process.env.API_POLLING_RATE_LIMIT || '300', 10)
    : 3000,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Too many polling requests. Please try again shortly.' },
  skip: (req: Request) => {
    if (isNodeProxyRequest(req)) return true;
    return !(req.method === 'GET' && POLLING_EXEMPT_PATHS.has(req.path));
  },
});

app.use('/api/', pollingLimiter);

// Tier W: Webhook trigger limiter. Applied inline on the trigger route handler.
// CI/CD platforms (GitHub Actions, GitLab runners) often share datacenter IPs,
// so a higher ceiling prevents dropped deployments during burst activity.
const webhookTriggerLimiter = rateLimit({
  ...rateLimitBase,
  max: process.env.NODE_ENV === 'production' ? 500 : 5000,
  message: { error: 'Too many webhook triggers. Please try again shortly.' },
});

// JSON body parser that also captures the raw bytes for HMAC verification.
const jsonParser = express.json({
  verify: (req, _res, buf) => {
    (req as unknown as { rawBody: Buffer }).rawBody = buf;
  },
});

// Conditionally parse JSON bodies. Remote proxy requests must NOT have their body
// consumed here: express.json() drains the IncomingMessage stream into req.body
// and http-proxy then pipes an already-ended stream to the remote server.
// When Node.js pipes an ended readable it calls process.nextTick(dest.end()),
// which fires *before* the proxyReq socket event, so any attempt to write the
// body inside the proxyReq handler results in "write after end" and the request
// hangs. Solution: skip JSON parsing for remote-targeted /api/ requests so the
// raw stream flows through the proxy intact.
app.use((req: Request, res: Response, next: NextFunction): void => {
  const nodeIdHeader = req.headers['x-node-id'];
  if (nodeIdHeader) {
    const nodeId = parseInt(nodeIdHeader as string, 10);
    const node = NodeRegistry.getInstance().getNode(nodeId);
    if (
      node?.type === 'remote' &&
      req.path.startsWith('/api/') &&
      !req.path.startsWith('/api/auth/') &&
      !req.path.startsWith('/api/nodes') &&
      !req.path.startsWith('/api/license') &&
      !req.path.startsWith('/api/fleet') &&
      !req.path.startsWith('/api/webhooks') &&
      !req.path.startsWith('/api/meta')
    ) {
      // Preserve body stream for proxy piping
      next();
      return;
    }
  }
  jsonParser(req, res, next);
});

// Node Context Middleware
const nodeContextMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const nodeIdHeader = req.headers['x-node-id'] as string;
  const nodeIdQuery = req.query.nodeId as string;
  if (nodeIdHeader) {
    req.nodeId = parseInt(nodeIdHeader, 10);
  } else if (nodeIdQuery) {
    req.nodeId = parseInt(nodeIdQuery, 10);
  } else {
    req.nodeId = NodeRegistry.getInstance().getDefaultNodeId();
  }

  // Intercept requests to deleted nodes to prevent downstream errors.
  // /api/nodes is intentionally exempt: it must always be reachable so the
  // frontend can re-sync after a node is deleted (otherwise a stale x-node-id
  // in localStorage causes an unrecoverable 404 loop).
  if (
    req.path.startsWith('/api/') &&
    !req.path.startsWith('/api/auth/') &&
    !req.path.startsWith('/api/nodes') &&
    !req.path.startsWith('/api/license') &&
    !req.path.startsWith('/api/fleet') &&
    !req.path.startsWith('/api/webhooks') &&
    !req.path.startsWith('/api/meta')
  ) {
    const node = DatabaseService.getInstance().getNode(req.nodeId);
    if (!node) {
      res.status(404).json({ error: `Node with id ${req.nodeId} not found or was deleted.` });
      return;
    }
  }

  next();
};

app.use(nodeContextMiddleware);

// Extend Express Request type for user and node
declare global {
  namespace Express {
    interface Request {
      user?: { username: string; role: UserRole; userId: number };
      nodeId: number;
      apiTokenScope?: 'read-only' | 'deploy-only' | 'full-admin';
      rawBody?: Buffer;
      /** License tier asserted by the main instance on proxied requests. Only set for trusted node_proxy tokens. */
      proxyTier?: LicenseTier;
      /** License variant asserted by the main instance on proxied requests. Only set for trusted node_proxy tokens. */
      proxyVariant?: LicenseVariant;
    }
  }
}

// WebSocket proxy server for forwarding remote node WS connections
const wsProxyServer = httpProxy.createProxyServer({ changeOrigin: true });
wsProxyServer.on('error', (err, _req, socket: any) => {
  console.error('[WS Proxy] Error:', err.message);
  try { socket?.destroy(); } catch { }
});

// Authentication Middleware
// Accepts both cookie auth (browser sessions) and Bearer token auth (Sencho-to-Sencho proxy).
// Bearer token is evaluated first: node-to-node proxy calls always carry a Bearer token and
// should never be shadowed by a stale or cross-instance cookie.
const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const cookieToken = req.cookies[COOKIE_NAME];
  const bearerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = bearerToken || cookieToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) throw new Error('No JWT secret');
    const decoded = jwt.verify(token, jwtSecret) as { username?: string; role?: string; scope?: string; tv?: number };

    if (isDebugEnabled()) console.log('[Auth:diag] Token type:', bearerToken ? 'bearer' : 'cookie', 'scope:', decoded.scope || 'user-session');

    // API token path: scope-based programmatic access
    if (decoded.scope === 'api_token') {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const apiToken = DatabaseService.getInstance().getApiTokenByHash(tokenHash);
      if (!apiToken || apiToken.revoked_at) {
        if (isDebugEnabled()) console.log('[Auth:diag] API token rejected: not found or revoked');
        res.status(401).json({ error: 'API token not found or revoked' });
        return;
      }
      if (apiToken.expires_at && apiToken.expires_at < Date.now()) {
        if (isDebugEnabled()) console.log('[Auth:diag] API token rejected: expired');
        res.status(401).json({ error: 'API token has expired' });
        return;
      }
      DatabaseService.getInstance().updateApiTokenLastUsed(apiToken.id);
      const creator = DatabaseService.getInstance().getUserById(apiToken.user_id);
      const roleMap: Record<string, UserRole> = {
        'read-only': 'viewer',
        'deploy-only': 'deployer',
        'full-admin': 'admin',
      };
      req.user = { username: creator?.username || `api-token:${apiToken.name}`, role: roleMap[apiToken.scope] || 'viewer', userId: apiToken.user_id };
      req.apiTokenScope = apiToken.scope as 'read-only' | 'deploy-only' | 'full-admin';
      if (isDebugEnabled()) console.log('[Auth:diag] API token authenticated:', { scope: apiToken.scope, user: creator?.username, tokenName: apiToken.name });
      next();
      return;
    }

    // Node proxy tokens: Sencho-to-Sencho communication, not user sessions.
    // Handle before user resolution since proxy tokens have no username.
    if (decoded.scope === 'node_proxy') {
      req.user = { username: 'node-proxy', role: 'admin', userId: 0 };

      // Distributed License Enforcement: trust tier headers only from authenticated node proxy requests.
      // Browser sessions and API tokens cannot set these; only a valid node_proxy JWT (signed with
      // this instance's JWT secret) unlocks the trusted path.
      const tierHeader = req.headers[PROXY_TIER_HEADER] as string | undefined;
      const variantHeader = req.headers[PROXY_VARIANT_HEADER] as string | undefined;
      if (isLicenseTier(tierHeader)) {
        req.proxyTier = normalizeTier(tierHeader);
      }
      if (isLicenseVariant(variantHeader)) {
        req.proxyVariant = normalizeVariant(variantHeader);
      } else if (variantHeader === '') {
        req.proxyVariant = null;
      }
      next();
      return;
    }

    // User session tokens: resolve against the database for up-to-date role and existence checks.
    const dbUser = decoded.username ? DatabaseService.getInstance().getUserByUsername(decoded.username) : undefined;

    // User must exist in the database (rejects deleted users immediately)
    if (!dbUser) {
      res.status(401).json({ error: 'User account no longer exists' });
      return;
    }

    // Token version check: rejects sessions after password change, role change, or admin reset.
    // Pre-migration tokens (no tv claim) are accepted for backward compat and expire within 24h.
    if (decoded.tv !== undefined && dbUser.token_version !== decoded.tv) {
      if (isDebugEnabled()) console.log('[Auth:diag] Token version mismatch for:', decoded.username, 'jwt:', decoded.tv, 'db:', dbUser.token_version);
      console.log('[Auth] Session rejected: token version mismatch for:', decoded.username);
      res.status(401).json({ error: 'Session invalidated. Please log in again.' });
      return;
    }

    if (isDebugEnabled()) console.log('[Auth:diag] User resolved:', dbUser.username, 'role:', dbUser.role, 'tv:', dbUser.token_version);

    // Use the DB role (not the JWT role) so role changes take effect immediately
    req.user = { username: dbUser.username, role: dbUser.role as UserRole, userId: dbUser.id };

    next();
  } catch (err) {
    console.error('[Auth] Token validation failed:', (err as Error).message);
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
};

/** Sign a session JWT and set it as an httpOnly cookie. */
function issueSessionCookie(
  res: Response,
  req: Request,
  user: { username: string; role: string; token_version: number },
  jwtSecret: string,
): void {
  const token = jwt.sign(
    { username: user.username, role: user.role, tv: user.token_version },
    jwtSecret,
    { expiresIn: '24h' },
  );
  res.cookie(COOKIE_NAME, token, getCookieOptions(req));
}

// Rate limiter for auth endpoints - prevents brute-force attacks.
// Production: 5 attempts per 15-minute window per IP.
// Development: 100 attempts (so E2E tests and local tooling are not blocked).
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

// Captured at boot. Exposed via /api/health and /api/meta so the Fleet update overlay
// can distinguish a brand-new process from the old one still mid-pull.
const processStartedAt = Date.now();

// Public health endpoint - no auth required (used by Docker HEALTHCHECK and uptime monitors)
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', uptime: process.uptime(), startedAt: processStartedAt });
});

// Public meta endpoint - returns this instance's version and supported capabilities.
// No auth required (like /health). Used by remote nodes during connection tests.
app.get('/api/meta', (_req: Request, res: Response): void => {
  const updateError = SelfUpdateService.getInstance().getLastError();
  res.json({
    version: getSenchoVersion(),
    capabilities: getActiveCapabilities(),
    startedAt: processStartedAt,
    ...(updateError ? { updateError } : {}),
  });
});

// Auth Routes (no authentication required)

// Check if setup is needed
app.get('/api/auth/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const needsSetup = !settings.auth_username || !settings.auth_password_hash || !settings.auth_jwt_secret;
    res.json({ needsSetup });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.json({ needsSetup: true });
  }
});

// Initial setup endpoint
app.post('/api/auth/setup', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const dbSvc = DatabaseService.getInstance();
    const settings = dbSvc.getGlobalSettings();
    const needsSetup = !settings.auth_username || !settings.auth_password_hash || !settings.auth_jwt_secret;
    if (!needsSetup) {
      res.status(400).json({ error: 'Setup has already been completed' });
      return;
    }

    const { username, password, confirmPassword } = req.body;

    // Validation
    if (!username || !password || !confirmPassword) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (username.length < 3) {
      res.status(400).json({ error: 'Username must be at least 3 characters' });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match' });
      return;
    }

    // Save credentials (this also generates the JWT secret)
    const passwordHash = await bcrypt.hash(password, 10);
    const jwtSecret = crypto.randomBytes(64).toString('hex');
    dbSvc.updateGlobalSetting('auth_username', username);
    dbSvc.updateGlobalSetting('auth_password_hash', passwordHash);
    dbSvc.updateGlobalSetting('auth_jwt_secret', jwtSecret);

    // Create admin user in users table
    dbSvc.addUser({ username, password_hash: passwordHash, role: 'admin' });

    // Issue JWT and log user in
    issueSessionCookie(res, req, { username, role: 'admin', token_version: 1 }, jwtSecret);
    res.json({ success: true, message: 'Setup completed successfully' });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Failed to complete setup' });
  }
});

// Login endpoint
app.post('/api/auth/login', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  try {
    const db = DatabaseService.getInstance();
    const user = db.getUserByUsername(username);

    if (user) {
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (isValid) {
        const settings = db.getGlobalSettings();
        const jwtSecret = settings.auth_jwt_secret;
        if (!jwtSecret) throw new Error('JWT secret missing from DB');
        issueSessionCookie(res, req, user, jwtSecret);
        console.log('[Auth] Login successful:', user.username);
        res.json({ success: true, message: 'Login successful' });
        return;
      }
    }

    console.warn('[Auth] Login failed for username:', username);
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Update password endpoint - any authenticated user can change their own password
app.put('/api/auth/password', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot change passwords.', code: 'SCOPE_DENIED' });
    return;
  }
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Old password and new password are required' });
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    const dbSvc = DatabaseService.getInstance();
    const user = dbSvc.getUserByUsername(req.user!.username);

    if (!user) {
      res.status(400).json({ error: 'User not found' });
      return;
    }

    const isValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid old password' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    dbSvc.updateUser(user.id, { password_hash: newHash });
    // Keep global_settings in sync for backward compat
    dbSvc.updateGlobalSetting('auth_password_hash', newHash);
    // Invalidate all other sessions for this user
    dbSvc.bumpTokenVersion(user.id);
    // Re-issue cookie with new token version so the current session survives
    const settings = dbSvc.getGlobalSettings();
    const updatedUser = dbSvc.getUserById(user.id);
    if (settings.auth_jwt_secret && updatedUser) {
      issueSessionCookie(res, req, updatedUser, settings.auth_jwt_secret);
    }
    console.log('[Auth] Password changed by:', req.user!.username);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('[Auth] Password update error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response): void => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'strict',
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

// Check authentication status
app.get('/api/auth/check', authMiddleware, (req: Request, res: Response): void => {
  res.json({ authenticated: true, user: req.user });
});

// Generate a long-lived node proxy token for Sencho-to-Sencho authentication
app.post('/api/auth/generate-node-token', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot generate node tokens.', code: 'SCOPE_DENIED' });
    return;
  }
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) {
      res.status(500).json({ error: 'No JWT secret configured on this instance.' });
      return;
    }
    // Default 1-year expiry — admin should rotate tokens periodically
    const token = jwt.sign({ scope: 'node_proxy' }, jwtSecret, { expiresIn: '365d' });
    res.json({ token });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to generate node token' });
  }
});

// --- SSO Auth Routes (public, under /api/auth/sso/*) ---

// Seed SSO config from environment variables on startup
SSOService.getInstance().seedFromEnv();

const ssoRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many SSO attempts. Please try again later.' },
});

// List enabled SSO providers (for login page)
app.get('/api/auth/sso/providers', (_req: Request, res: Response): void => {
  try {
    const providers = SSOService.getInstance().getEnabledProviders();
    res.json(providers);
  } catch (e) {
    console.warn('[SSO] Failed to list enabled providers, returning empty list:', (e as Error).message);
    res.json([]);
  }
});

// LDAP login
app.post('/api/auth/sso/ldap', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const result = await SSOService.getInstance().authenticateLDAP(username, password);
    if (!result.success || !result.user) {
      res.status(401).json({ error: result.error || 'Authentication failed' });
      return;
    }

    // Provision or find existing user
    const user = SSOService.getInstance().provisionUser({
      authProvider: 'ldap',
      providerId: result.user.providerId,
      preferredUsername: result.user.preferredUsername,
      email: result.user.email,
      role: result.user.role,
    });

    // Issue JWT (same as local login)
    const settings = DatabaseService.getInstance().getGlobalSettings();
    issueSessionCookie(res, req, user, settings.auth_jwt_secret);
    console.log(`[SSO] LDAP login successful: ${user.username}`);
    res.json({ success: true, message: 'Login successful' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'LDAP login failed';
    console.error('[SSO] LDAP login error:', msg);
    res.status(500).json({ error: msg });
  }
});

// OIDC: Initiate authorization flow
app.get('/api/auth/sso/oidc/:provider/authorize', ssoRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const provider = String(req.params.provider);
    const validProviders = ['oidc_google', 'oidc_github', 'oidc_okta'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: 'Invalid SSO provider' });
      return;
    }

    const baseUrl = process.env.SSO_CALLBACK_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/api/auth/sso/oidc/${provider}/callback`;

    const { url, state, codeVerifier } = await SSOService.getInstance().getOIDCAuthorizationUrl(provider, callbackUrl);

    // Store state + codeVerifier in an encrypted short-lived cookie
    const cryptoSvc = (await import('./services/CryptoService')).CryptoService.getInstance();
    const statePayload = JSON.stringify({ state, codeVerifier, provider });
    res.cookie('sencho_sso_state', cryptoSvc.encrypt(statePayload), {
      httpOnly: true,
      secure: isSecureRequest(req),
      sameSite: 'lax', // Must be lax for cross-site IdP redirect
      maxAge: 5 * 60 * 1000, // 5 minutes
    });

    res.redirect(url);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'SSO initialization failed';
    console.error('[SSO] OIDC authorize error:', msg);
    res.redirect(`/?sso_error=${encodeURIComponent(msg)}`);
  }
});

// OIDC: Callback from identity provider
app.get('/api/auth/sso/oidc/:provider/callback', ssoRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const provider = String(req.params.provider);
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const oidcError = req.query.error ? String(req.query.error) : '';
    const error_description = req.query.error_description ? String(req.query.error_description) : '';

    if (oidcError) {
      res.redirect(`/?sso_error=${encodeURIComponent(error_description || oidcError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect('/?sso_error=Missing+authorization+code');
      return;
    }

    // Read and validate state cookie
    const stateCookie = req.cookies?.sencho_sso_state;
    // Always clear the one-time state cookie, regardless of outcome
    res.clearCookie('sencho_sso_state', { httpOnly: true, secure: isSecureRequest(req), sameSite: 'lax' });
    if (!stateCookie) {
      res.redirect('/?sso_error=SSO+session+expired.+Please+try+again.');
      return;
    }

    const cryptoSvc = (await import('./services/CryptoService')).CryptoService.getInstance();
    let statePayload: { state: string; codeVerifier: string; provider: string };
    try {
      statePayload = JSON.parse(cryptoSvc.decrypt(stateCookie));
    } catch (e) {
      console.error('[SSO] Failed to decrypt SSO state cookie:', (e as Error).message);
      res.redirect('/?sso_error=Invalid+SSO+session');
      return;
    }

    if (statePayload.provider !== provider) {
      res.redirect(`/?sso_error=${encodeURIComponent(`Provider mismatch: expected ${statePayload.provider}, got ${provider}`)}`);
      return;
    }

    const baseUrl = process.env.SSO_CALLBACK_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/api/auth/sso/oidc/${provider}/callback`;

    const result = await SSOService.getInstance().handleOIDCCallback(
      provider, callbackUrl,
      { code, state },
      statePayload.state,
      statePayload.codeVerifier
    );

    if (!result.success || !result.user) {
      res.redirect(`/?sso_error=${encodeURIComponent(result.error || 'Authentication failed')}`);
      return;
    }

    // Provision or find existing user
    const user = SSOService.getInstance().provisionUser({
      authProvider: provider as AuthProvider,
      providerId: result.user.providerId,
      preferredUsername: result.user.preferredUsername,
      email: result.user.email,
      role: result.user.role,
    });

    // Issue JWT + cookie (same as local login)
    const settings = DatabaseService.getInstance().getGlobalSettings();
    issueSessionCookie(res, req, user, settings.auth_jwt_secret);
    console.log(`[SSO] OIDC login successful: ${user.username} via ${provider}`);

    res.redirect('/');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'SSO callback failed';
    console.error('[SSO] OIDC callback error:', msg);
    res.redirect(`/?sso_error=${encodeURIComponent(msg)}`);
  }
});

// Apply authentication middleware to all /api/* routes except /api/auth/*
app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/auth/') || /^\/webhooks\/\d+\/trigger$/.test(req.path)) {
    next();
    return;
  }
  authMiddleware(req, res, next);
});

// Audit logging middleware - records all mutating API actions for Admiral accountability.
// Runs for POST/PUT/DELETE/PATCH on /api/* routes. Uses res.on('finish') to capture status code.
import { getAuditSummary } from './utils/audit-summaries';

app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
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
});

// --- License Routes (local-only, never proxied) ---

// Paid feature guard: returns false and sends 403 if not on a paid tier (Skipper or Admiral).
// Checks req.proxyTier first (set by authMiddleware for trusted node proxy requests),
// falling back to the local LicenseService tier for direct access.
const requirePaid = (req: Request, res: Response): boolean => {
  const tier = req.proxyTier !== undefined ? req.proxyTier : LicenseService.getInstance().getTier();
  if (tier !== 'paid') {
    res.status(403).json({ error: 'This feature requires a Skipper or Admiral license.', code: 'PAID_REQUIRED' });
    return false;
  }
  return true;
};

// Admiral feature guard: requires paid tier with team variant.
// Checks req.proxyTier/proxyVariant first (set by authMiddleware for trusted node proxy
// requests), falling back to the local LicenseService for direct access.
const requireAdmiral = (req: Request, res: Response): boolean => {
  const ls = LicenseService.getInstance();
  const tier = req.proxyTier !== undefined ? req.proxyTier : ls.getTier();
  const variant = req.proxyVariant !== undefined ? req.proxyVariant : ls.getVariant();
  if (tier !== 'paid') {
    res.status(403).json({ error: 'This feature requires a Skipper or Admiral license.', code: 'PAID_REQUIRED' });
    return false;
  }
  if (variant !== 'admiral') {
    res.status(403).json({ error: 'This feature requires a Sencho Admiral license.', code: 'ADMIRAL_REQUIRED' });
    return false;
  }
  return true;
};

const requireAdmin = (req: Request, res: Response): boolean => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
    return false;
  }
  return true;
};

const requireBody = (req: Request, res: Response): boolean => {
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'Request body is required' });
    return false;
  }
  return true;
};

function isSqliteUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

// Tier gate for scheduled tasks: 'update' action requires Skipper+, everything else requires Admiral.
const requireScheduledTaskTier = (action: string, req: Request, res: Response): boolean => {
  if (action === 'update') return requirePaid(req, res);
  return requireAdmiral(req, res);
};

// --- Scoped RBAC Permission Engine (Admiral) ---

type PermissionAction =
  | 'stack:read' | 'stack:edit' | 'stack:deploy' | 'stack:create' | 'stack:delete'
  | 'node:read' | 'node:manage'
  | 'system:settings' | 'system:users' | 'system:license' | 'system:webhooks'
  | 'system:tokens' | 'system:console' | 'system:audit' | 'system:registries';

const ROLE_PERMISSIONS: Record<UserRole, PermissionAction[]> = {
  admin: [
    'stack:read', 'stack:edit', 'stack:deploy', 'stack:create', 'stack:delete',
    'node:read', 'node:manage',
    'system:settings', 'system:users', 'system:license', 'system:webhooks',
    'system:tokens', 'system:console', 'system:audit', 'system:registries',
  ],
  'node-admin': [
    'stack:read', 'stack:edit', 'stack:deploy', 'stack:create', 'stack:delete',
    'node:read', 'node:manage',
  ],
  deployer: [
    'stack:read', 'stack:deploy',
  ],
  viewer: [
    'stack:read', 'node:read',
  ],
  auditor: [
    'stack:read', 'node:read', 'system:audit',
  ],
};

/**
 * Core permission resolver. Checks if the current user can perform `action` on an optional resource.
 * 1. Admin → always true (backward compat)
 * 2. Check global role permissions
 * 3. If resource specified AND Admiral → check scoped role_assignments
 */
function checkPermission(
  req: Request,
  action: PermissionAction,
  resourceType?: ResourceType,
  resourceId?: string,
): boolean {
  if (!req.user) return false;

  const globalRole = req.user.role;

  if (isDebugEnabled()) console.log('[RBAC:diag] checkPermission:', action, 'user:', req.user.username, 'globalRole:', globalRole, 'resource:', resourceType, resourceId);

  // Admins always have full access
  if (globalRole === 'admin') return true;

  // Check if the user's global role grants this action
  if (ROLE_PERMISSIONS[globalRole]?.includes(action)) return true;

  // Scoped assignments only apply when a resource is specified and license is Admiral
  if (!resourceType || !resourceId) return false;
  const variant = req.proxyVariant !== undefined ? req.proxyVariant : LicenseService.getInstance().getVariant();
  if (variant !== 'admiral') return false;

  const assignments = DatabaseService.getInstance().getRoleAssignments(req.user.userId, resourceType, resourceId);
  if (isDebugEnabled()) console.log('[RBAC:diag] Scoped assignments found:', assignments.length, 'for user:', req.user.userId);
  for (const assignment of assignments) {
    if (ROLE_PERMISSIONS[assignment.role]?.includes(action)) return true;
  }

  return false;
}

/** Generic permission guard — sends 403 if denied. */
function requirePermission(
  req: Request,
  res: Response,
  action: PermissionAction,
  resourceType?: ResourceType,
  resourceId?: string,
): boolean {
  if (checkPermission(req, action, resourceType, resourceId)) return true;
  res.status(403).json({ error: 'Permission denied.', code: 'PERMISSION_DENIED' });
  return false;
}

// Scope enforcement for API tokens - restricts which endpoints a token can reach.
const DEPLOY_ALLOWED_PATTERNS: RegExp[] = [
  /^\/api\/stacks\/[^/]+\/deploy$/,
  /^\/api\/stacks\/[^/]+\/down$/,
  /^\/api\/stacks\/[^/]+\/restart$/,
  /^\/api\/stacks\/[^/]+\/stop$/,
  /^\/api\/stacks\/[^/]+\/start$/,
  /^\/api\/stacks\/[^/]+\/update$/,
];

const enforceApiTokenScope = (req: Request, res: Response, next: NextFunction): void => {
  const scope = req.apiTokenScope;
  if (!scope) { next(); return; } // Not an API token request
  if (isDebugEnabled()) console.log('[ApiTokenScope:diag]', req.method, req.path, 'scope:', scope);
  if (scope === 'full-admin') { next(); return; }

  if (scope === 'read-only') {
    if (req.method !== 'GET') {
      if (isDebugEnabled()) console.log('[ApiTokenScope:diag] Denied:', req.method, req.path, 'scope:', scope);
      res.status(403).json({ error: 'API token scope "read-only" only allows GET requests.', code: 'SCOPE_DENIED' });
      return;
    }
    next();
    return;
  }

  if (scope === 'deploy-only') {
    if (req.method === 'GET') { next(); return; }
    const fullPath = `/api${req.path}`;
    if (req.method === 'POST' && DEPLOY_ALLOWED_PATTERNS.some(p => p.test(fullPath))) {
      next();
      return;
    }
    if (isDebugEnabled()) console.log('[ApiTokenScope:diag] Denied:', req.method, req.path, 'scope:', scope);
    res.status(403).json({ error: 'API token scope "deploy-only" does not allow this action.', code: 'SCOPE_DENIED' });
    return;
  }

  if (isDebugEnabled()) console.log('[ApiTokenScope:diag] Denied: unknown scope', req.method, req.path, 'scope:', scope);
  res.status(403).json({ error: 'Unknown API token scope.', code: 'SCOPE_DENIED' });
};

app.use('/api', enforceApiTokenScope);

app.get('/api/license', (_req: Request, res: Response): void => {
  try {
    const info = LicenseService.getInstance().getLicenseInfo();
    res.json(info);
  } catch (error) {
    console.error('[License] Error getting license info:', error);
    res.status(500).json({ error: 'Failed to retrieve license information' });
  }
});

app.post('/api/license/activate', async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage licenses.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  try {
    const { license_key } = req.body;
    if (!license_key || typeof license_key !== 'string') {
      res.status(400).json({ error: 'A valid license key is required' });
      return;
    }
    const result = await LicenseService.getInstance().activate(license_key.trim());
    if (result.success) {
      res.json({ success: true, license: LicenseService.getInstance().getLicenseInfo() });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('[License] Activation error:', error);
    res.status(500).json({ error: 'License activation failed' });
  }
});

app.post('/api/license/deactivate', async (_req: Request, res: Response): Promise<void> => {
  if (_req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage licenses.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(_req, res)) return;
  try {
    const result = await LicenseService.getInstance().deactivate();
    if (result.success) {
      res.json({ success: true, license: LicenseService.getInstance().getLicenseInfo() });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('[License] Deactivation error:', error);
    res.status(500).json({ error: 'License deactivation failed' });
  }
});

app.post('/api/license/validate', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await LicenseService.getInstance().validate();
    res.json({ ...result, license: LicenseService.getInstance().getLicenseInfo() });
  } catch (error) {
    console.error('[License] Validation error:', error);
    res.status(500).json({ error: 'License validation failed' });
  }
});

app.get('/api/license/billing-portal', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await LicenseService.getInstance().getBillingPortalUrl();
    if ('error' in result) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ url: result.url });
  } catch (error) {
    console.error('[License] Billing portal error:', error);
    res.status(500).json({ error: 'Failed to retrieve billing portal URL' });
  }
});

// --- Self-Update ---

/** Respond 202 and trigger the "last breath" self-update after the response flushes. */
function scheduleLocalUpdate(res: Response, message: string): void {
  res.status(202).json({ message });
  res.on('finish', () => {
    setTimeout(() => {
      // Defense in depth: triggerUpdate records its own errors into lastUpdateError,
      // but guard against an unexpected throw becoming an unhandled rejection.
      SelfUpdateService.getInstance().triggerUpdate().catch((err) => {
        console.error('[SelfUpdate] Unexpected error during triggerUpdate:', err);
      });
    }, 500);
  });
}

app.post('/api/system/update', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!SelfUpdateService.getInstance().isAvailable()) {
    res.status(503).json({ error: 'Self-update unavailable. Sencho must be deployed via Docker Compose.' });
    return;
  }
  scheduleLocalUpdate(res, 'Update initiated. The server will restart shortly.');
});

// --- Fleet Overview (local-only, aggregates all nodes) ---

// In-memory tracker for remote node updates (transient — lost on gateway restart)
interface UpdateTracker {
  status: 'updating' | 'completed' | 'timeout' | 'failed';
  startedAt: number;
  previousVersion: string | null;
  error?: string;
  /** Process start time of the remote node before the update was triggered. */
  previousProcessStart: number | null;
  /** True when the node became unreachable at least once during the update window. */
  wasOffline: boolean;
  /** Timestamp when the tracker transitioned to a terminal state (completed/failed/timeout). */
  resolvedAt?: number;
}
const updateTracker = new Map<number, UpdateTracker>();
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const UPDATE_TIMEOUT_MSG = 'Node did not come back online within 5 minutes.';
const EARLY_FAIL_MS = 180 * 1000; // 3 minutes before declaring a probable pull failure

// Latest Sencho version lookup and caching live in utils/version-check.ts
// (shared with MonitorService). Fleet compares the gateway version against
// whatever getLatestVersion() returns from GitHub or Docker Hub.

/** Resolve the version to compare nodes against (latest from GitHub, or gateway fallback). */
async function getCompareTarget(gatewayVersion: string | null) {
  const latestVersion = await getLatestVersion();
  const latestValid = latestVersion !== null && isValidVersion(latestVersion);
  const result = {
    latestVersion,
    latestValid,
    compareVersion: latestValid ? latestVersion : gatewayVersion,
    compareValid: latestValid || isValidVersion(gatewayVersion),
  };
  if (isDebugEnabled()) {
    console.debug('[Fleet:debug] Compare target resolved:', { gatewayVersion, latestVersion, using: result.compareVersion, valid: result.compareValid });
  }
  return result;
}

function createTracker(
  status: UpdateTracker['status'],
  previousVersion: string | null,
  previousProcessStart: number | null,
  error?: string,
): UpdateTracker {
  const now = Date.now();
  return {
    status, startedAt: now, previousVersion, previousProcessStart, wasOffline: false, error,
    resolvedAt: status !== 'updating' ? now : undefined,
  };
}

/** Transition a tracker to a terminal state, setting resolvedAt automatically. */
function resolveTracker(tracker: UpdateTracker, status: 'completed' | 'failed' | 'timeout', error?: string): UpdateTracker {
  return { ...tracker, status, resolvedAt: Date.now(), error };
}

interface FleetNodeOverview {
  id: number;
  name: string;
  type: 'local' | 'remote';
  status: 'online' | 'offline' | 'unknown';
  stats: {
    active: number;
    managed: number;
    unmanaged: number;
    exited: number;
    total: number;
  } | null;
  systemStats: {
    cpu: { usage: string; cores: number };
    memory: { total: number; used: number; free: number; usagePercent: string };
    disk: { total: number; used: number; free: number; usagePercent: string } | null;
  } | null;
  stacks: string[] | null;
}

app.get('/api/fleet/overview', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  try {
    const debug = isDebugEnabled();
    const db = DatabaseService.getInstance();
    const nodes = db.getNodes();
    if (debug) console.debug('[Fleet:debug] Overview requested, fetching', nodes.length, 'nodes');

    const results = await Promise.allSettled(
      nodes.map(async (node): Promise<FleetNodeOverview> => {
        if (node.type === 'remote') {
          return fetchRemoteNodeOverview(node);
        }
        return fetchLocalNodeOverview(node);
      })
    );

    const overview: FleetNodeOverview[] = results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      console.error(`[Fleet] Failed to fetch node ${nodes[i].name}:`, result.reason);
      return {
        id: nodes[i].id,
        name: nodes[i].name,
        type: nodes[i].type,
        status: 'offline' as const,
        stats: null,
        systemStats: null,
        stacks: null,
      };
    });

    if (debug) {
      const online = overview.filter(n => n.status === 'online').length;
      console.debug('[Fleet:debug] Overview complete:', online, 'online,', overview.length - online, 'offline');
    }
    res.json(overview);
  } catch (error) {
    console.error('[Fleet] Overview error:', error);
    res.status(500).json({ error: 'Failed to fetch fleet overview' });
  }
});

// Paid-gated: detailed stack info per node
app.get('/api/fleet/node/:nodeId/stacks', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;

  try {
    const nodeId = parseInt(req.params.nodeId as string, 10);
    if (isNaN(nodeId)) { res.status(400).json({ error: 'Invalid node ID' }); return; }
    const node = DatabaseService.getInstance().getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    if (node.type === 'remote') {
      if (!node.api_url || !node.api_token) {
        res.status(503).json({ error: 'Remote node not configured' });
        return;
      }
      const response = await fetch(`${node.api_url.replace(/\/$/, '')}/api/stacks`, {
        headers: { Authorization: `Bearer ${node.api_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        res.status(502).json({ error: 'Failed to fetch stacks from remote node' });
        return;
      }
      const stacks = await response.json();
      if (isDebugEnabled()) console.debug('[Fleet:debug] Node stacks:', nodeId, node.type, Array.isArray(stacks) ? stacks.length : 0, 'stacks');
      res.json(stacks);
      return;
    }

    const stacks = await FileSystemService.getInstance(nodeId).getStacks();
    if (isDebugEnabled()) console.debug('[Fleet:debug] Node stacks:', nodeId, node.type, stacks.length, 'stacks');
    res.json(stacks);
  } catch (error) {
    console.error('[Fleet] Node stacks error:', error);
    res.status(500).json({ error: 'Failed to fetch node stacks' });
  }
});

// Paid-gated: container details for a specific stack on a specific node
app.get('/api/fleet/node/:nodeId/stacks/:stackName/containers', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;

  try {
    const nodeId = parseInt(req.params.nodeId as string, 10);
    if (isNaN(nodeId)) { res.status(400).json({ error: 'Invalid node ID' }); return; }
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      res.status(400).json({ error: 'Invalid stack name' });
      return;
    }
    const node = DatabaseService.getInstance().getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    if (node.type === 'remote') {
      if (!node.api_url || !node.api_token) {
        res.status(503).json({ error: 'Remote node not configured' });
        return;
      }
      const response = await fetch(`${node.api_url.replace(/\/$/, '')}/api/stacks/${encodeURIComponent(stackName)}/containers`, {
        headers: { Authorization: `Bearer ${node.api_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        res.status(502).json({ error: 'Failed to fetch containers from remote node' });
        return;
      }
      const containers = await response.json();
      res.json(containers);
      return;
    }

    const dockerController = DockerController.getInstance(nodeId);
    const containers = await dockerController.getContainersByStack(stackName);
    if (isDebugEnabled()) console.debug('[Fleet:debug] Stack containers:', nodeId, stackName, containers.length, 'containers');
    res.json(containers);
  } catch (error) {
    console.error('[Fleet] Node stack containers error:', error);
    res.status(500).json({ error: 'Failed to fetch stack containers' });
  }
});

// Fleet Update Status — returns version comparison and active update status for all nodes
app.get('/api/fleet/update-status', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  if (!requirePaid(_req, res)) return;
  try {
    const db = DatabaseService.getInstance();
    const nodes = db.getNodes();
    const gatewayVersion = getSenchoVersion();
    const gatewayValid = isValidVersion(gatewayVersion);

    const { latestVersion, latestValid, compareVersion, compareValid } = await getCompareTarget(gatewayVersion);
    const debug = isDebugEnabled();

    const results = await Promise.allSettled(
      nodes.map(async (node) => {
        const tracker = updateTracker.get(node.id);

        let version: string | null = null;
        let remoteStartedAt: number | null = null;
        let remoteUpdateError: string | null = null;
        let remoteOnline = false;
        if (node.type === 'local') {
          version = gatewayVersion;
        } else if (node.api_url && node.api_token) {
          const meta = await fetchRemoteMeta(node.api_url, node.api_token);
          version = meta.version;
          remoteStartedAt = meta.startedAt;
          remoteUpdateError = meta.updateError;
          remoteOnline = meta.online;
        }

        // For nodes actively updating, check if they've come back
        if (tracker?.status === 'updating') {
          const elapsed = Date.now() - tracker.startedAt;

          if (debug) {
            console.debug('[Fleet:debug] Polling update status for node', node.id, node.name, '- elapsed:', Math.round(elapsed / 1000) + 's', 'version:', version, 'wasOffline:', tracker.wasOffline, 'remoteOnline:', remoteOnline);
          }

          if (elapsed > UPDATE_TIMEOUT_MS) {
            // Final timeout (5 min)
            if (debug) console.debug('[Fleet:debug] Node', node.id, 'timed out after', Math.round(elapsed / 1000) + 's');
            updateTracker.set(node.id, resolveTracker(tracker, 'timeout', UPDATE_TIMEOUT_MSG));
          } else if (node.type === 'remote') {
            if (remoteUpdateError) {
              // Remote reported a pull failure via /api/meta
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'reported pull failure:', remoteUpdateError);
              updateTracker.set(node.id, resolveTracker(tracker, 'failed', remoteUpdateError));
            } else if (!remoteOnline) {
              // Node is unreachable (restarting); record that it went offline
              if (!tracker.wasOffline) {
                if (debug) console.debug('[Fleet:debug] Node', node.id, 'went offline (restarting)');
                updateTracker.set(node.id, { ...tracker, wasOffline: true });
              }
            } else if (version !== tracker.previousVersion) {
              // Signal 1: Version changed (or version now resolvable after being unknown)
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 1 (version changed):', tracker.previousVersion, '->', version);
              updateTracker.set(node.id, resolveTracker(tracker, 'completed'));
            } else if (
              remoteStartedAt !== null &&
              tracker.previousProcessStart !== null &&
              remoteStartedAt !== tracker.previousProcessStart
            ) {
              // Signal 2: Process restarted (startedAt changed)
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 2 (process restarted):', tracker.previousProcessStart, '->', remoteStartedAt);
              updateTracker.set(node.id, resolveTracker(tracker, 'completed'));
            } else if (tracker.wasOffline && remoteOnline) {
              // Signal 3: Node went offline and is back online (container was recreated)
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 3 (offline then online)');
              updateTracker.set(node.id, resolveTracker(tracker, 'completed'));
            } else if (
              elapsed > 15_000 &&
              isValidVersion(version) &&
              gatewayValid &&
              !semver.lt(version, compareVersion!)
            ) {
              // Signal 4: Remote is now at or above gateway version (after minimum processing time).
              // Catches fast restarts where the 5s polling interval misses the offline window
              // and startedAt hasn't been observed to change yet.
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 4 (version >= compare target):', version, '>=', compareVersion);
              updateTracker.set(node.id, resolveTracker(tracker, 'completed'));
            } else if (elapsed > EARLY_FAIL_MS) {
              // Heuristic: node never went offline and nothing changed after 3 min
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'early fail after', Math.round(elapsed / 1000) + 's - no signals detected');
              updateTracker.set(node.id, resolveTracker(tracker, 'failed', 'Update may have failed. The node is still running and its version has not changed.'));
            }
          } else if (node.type === 'local') {
            // Local node has only two failure signals: an explicit pull/spawn error,
            // or the early-fail heuristic. Success is observed by the frontend overlay
            // (it reloads the page when /api/health reports a new startedAt), at which
            // point the new process starts with an empty tracker map.
            const selfUpdate = SelfUpdateService.getInstance();
            const localError = selfUpdate.getLastError();
            if (localError) {
              if (debug) console.debug('[Fleet:debug] Local node', node.id, 'update failed:', localError);
              updateTracker.set(node.id, resolveTracker(tracker, 'failed', localError));
              selfUpdate.clearLastError();
            } else if (elapsed > EARLY_FAIL_MS) {
              // Helper container likely failed silently. Surface failure before the 5 min timeout.
              if (debug) console.debug('[Fleet:debug] Local node', node.id, 'early fail after', Math.round(elapsed / 1000) + 's');
              updateTracker.set(node.id, resolveTracker(tracker, 'failed', 'Local update did not complete. The container may not have restarted; check Docker logs on the host.'));
            }
          }
        }

        // Auto-expire completed entries 60s after they resolved so the badge is visible
        if (tracker?.status === 'completed' && tracker.resolvedAt && Date.now() - tracker.resolvedAt > 60_000) {
          updateTracker.delete(node.id);
        }

        // Assume remote nodes are outdated when their version is unresolvable
        let updateAvailable = false;
        if (!isValidVersion(version)) {
          updateAvailable = node.type === 'remote';
        } else if (compareValid) {
          updateAvailable = semver.lt(version, compareVersion!);
        }

        const currentTracker = updateTracker.get(node.id);
        return {
          nodeId: node.id,
          name: node.name,
          type: node.type,
          version,
          latestVersion: latestValid ? latestVersion : gatewayVersion,
          updateAvailable,
          updateStatus: currentTracker?.status ?? null,
          error: currentTracker?.error ?? null,
        };
      })
    );

    const nodeStatuses = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        nodeId: nodes[i].id,
        name: nodes[i].name,
        type: nodes[i].type,
        version: null,
        latestVersion: latestValid ? latestVersion : gatewayVersion,
        updateAvailable: false,
        updateStatus: null,
        error: null,
      };
    });

    if (isDebugEnabled()) {
      const trackerStates = Array.from(updateTracker.entries()).map(([nid, t]) => `${nid}:${t.status}`);
      console.debug('[Fleet:debug] Update status:', nodeStatuses.length, 'nodes, trackers:', trackerStates.join(', ') || 'none');
    }
    res.json({ nodes: nodeStatuses });
  } catch (error) {
    console.error('[Fleet] Update status error:', error);
    res.status(500).json({ error: 'Failed to fetch update status' });
  }
});

// Trigger update on a specific node
app.post('/api/fleet/nodes/:nodeId/update', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  if (!requireAdmin(req, res)) return;
  try {
    const nodeId = parseInt(req.params.nodeId as string, 10);
    if (isNaN(nodeId)) { res.status(400).json({ error: 'Invalid node ID' }); return; }
    const db = DatabaseService.getInstance();
    const node = db.getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const existing = updateTracker.get(nodeId);
    if (existing?.status === 'updating') {
      if (Date.now() - existing.startedAt > UPDATE_TIMEOUT_MS) {
        updateTracker.set(nodeId, resolveTracker(existing, 'timeout', UPDATE_TIMEOUT_MSG));
      } else {
        res.status(409).json({ error: 'Update already in progress for this node.' });
        return;
      }
    }
    // Clear terminal states to allow retry
    if (existing && (existing.status === 'timeout' || existing.status === 'failed' || existing.status === 'completed')) {
      updateTracker.delete(nodeId);
    }

    console.log('[Fleet] Update triggered for node', node.name, node.type);
    if (isDebugEnabled()) {
      console.debug('[Fleet:debug] Update trigger details:', { nodeId, name: node.name, type: node.type, hasUrl: !!node.api_url, hasToken: !!node.api_token });
    }

    if (node.type === 'local') {
      if (!SelfUpdateService.getInstance().isAvailable()) {
        res.status(503).json({ error: 'Self-update unavailable on the local node.' });
        return;
      }
      updateTracker.set(nodeId, createTracker('updating', getSenchoVersion(), null));
      scheduleLocalUpdate(res, 'Update initiated on local node. The server will restart shortly.');
      return;
    }

    // Remote node
    if (!node.api_url || !node.api_token) {
      res.status(503).json({ error: 'Remote node not configured.' });
      return;
    }

    // Check remote availability and capabilities
    const meta = await fetchRemoteMeta(node.api_url, node.api_token);
    if (isDebugEnabled()) {
      console.debug('[Fleet:debug] Remote meta for update:', { nodeId, online: meta.online, version: meta.version, capabilities: meta.capabilities, startedAt: meta.startedAt });
    }
    if (!meta.online) {
      res.status(503).json({ error: 'Remote node is unreachable. Verify the node is running and the API URL is correct.' });
      return;
    }
    if (!meta.capabilities.includes('self-update')) {
      res.status(503).json({ error: 'Remote node does not support self-update. It may need to be updated manually first.' });
      return;
    }

    // Trigger remote update
    const response = await fetch(`${node.api_url.replace(/\/$/, '')}/api/system/update`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${node.api_token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errorMsg = (err as Record<string, string>)?.error || 'Remote node rejected update request.';
      updateTracker.set(nodeId, createTracker('failed', meta.version, meta.startedAt, errorMsg));
      res.status(502).json({ error: errorMsg });
      return;
    }

    updateTracker.set(nodeId, createTracker('updating', meta.version, meta.startedAt));
    res.status(202).json({ message: `Update initiated on ${node.name}.` });
  } catch (error) {
    console.error('[Fleet] Node update error:', error);
    const errorMsg = (error as Error)?.message || 'Failed to trigger node update.';
    const failedNodeId = parseInt(req.params.nodeId as string, 10);
    if (!isNaN(failedNodeId)) {
      updateTracker.set(failedNodeId, createTracker('failed', null, null, errorMsg));
    }
    res.status(500).json({ error: 'Failed to trigger node update.' });
  }
});

// Trigger update on all outdated nodes
app.post('/api/fleet/update-all', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  if (!requireAdmin(req, res)) return;
  try {
    const db = DatabaseService.getInstance();
    const nodes = db.getNodes();
    const gatewayVersion = getSenchoVersion();
    const { compareVersion, compareValid } = await getCompareTarget(gatewayVersion);

    const debug = isDebugEnabled();
    console.log('[Fleet] Update-all triggered,', nodes.length, 'nodes registered');
    if (debug) console.debug('[Fleet:debug] Update-all compare target:', { gatewayVersion, compareVersion, compareValid });

    // Filter to eligible candidates, then trigger all in parallel
    const candidates = nodes.filter(node => {
      if (node.type === 'local') return false;
      const tracker = updateTracker.get(node.id);
      if (tracker?.status === 'updating') return false;
      if (!node.api_url || !node.api_token) return false;
      // Clear terminal states so they can be re-triggered
      if (tracker && (tracker.status === 'timeout' || tracker.status === 'failed' || tracker.status === 'completed')) {
        updateTracker.delete(node.id);
      }
      return true;
    });

    const results = await Promise.allSettled(candidates.map(async (node) => {
      const meta = await fetchRemoteMeta(node.api_url!, node.api_token!);
      if (!meta.online) {
        return { name: node.name, triggered: false };
      }
      if (!meta.capabilities.includes('self-update')) {
        return { name: node.name, triggered: false };
      }
      if (isValidVersion(meta.version) && compareValid && !semver.lt(meta.version, compareVersion!)) {
        return { name: node.name, triggered: false };
      }
      const response = await fetch(`${node.api_url!.replace(/\/$/, '')}/api/system/update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${node.api_token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        updateTracker.set(node.id, createTracker('updating', meta.version, meta.startedAt));
        return { name: node.name, triggered: true };
      }
      return { name: node.name, triggered: false };
    }));

    const updating: string[] = [];
    const skipped = nodes.filter(n => !candidates.includes(n)).map(n => n.name);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const val = r.status === 'fulfilled' ? r.value : { name: candidates[i].name, triggered: false };
      (val.triggered ? updating : skipped).push(val.name);
    }

    if (debug) console.debug('[Fleet:debug] Update-all results:', { updating, skippedCount: skipped.length, candidateCount: candidates.length });
    res.status(202).json({ updating, skipped });
  } catch (error) {
    console.error('[Fleet] Update all error:', error);
    res.status(500).json({ error: 'Failed to trigger fleet update.' });
  }
});

// Clear update tracker entry for a specific node (dismiss or before retry)
app.delete('/api/fleet/nodes/:nodeId/update-status', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  try {
    const nodeId = parseInt(req.params.nodeId as string, 10);
    if (isNaN(nodeId)) { res.status(400).json({ error: 'Invalid node ID' }); return; }
    const node = DatabaseService.getInstance().getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    updateTracker.delete(nodeId);
    res.status(204).send();
  } catch (error) {
    console.error('[Fleet] Clear update status error:', error);
    res.status(500).json({ error: 'Failed to clear update status.' });
  }
});

// Clear all terminal (timed-out, failed, completed) tracker entries at once
app.delete('/api/fleet/update-status', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  // Pre-fetch fresh latest version so the next GET has up-to-date data
  if (req.query.recheck === 'true') {
    await getLatestVersion(true);
  }
  for (const [nodeId, tracker] of updateTracker) {
    if (tracker.status === 'timeout' || tracker.status === 'failed' || tracker.status === 'completed') {
      updateTracker.delete(nodeId);
    }
  }
  res.status(204).send();
});

async function fetchLocalNodeOverview(node: Node): Promise<FleetNodeOverview> {
  try {
    const composeDir = path.resolve(NodeRegistry.getInstance().getComposeDir(node.id));
    const [allContainers, stacks, currentLoad, mem, fsSize] = await Promise.all([
      DockerController.getInstance(node.id).getAllContainers(),
      FileSystemService.getInstance(node.id).getStacks(),
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
    ]);

    const isManagedByComposeDir = (c: Dockerode.ContainerInfo): boolean => {
      const workingDir: string | undefined = c.Labels?.['com.docker.compose.project.working_dir'];
      if (!workingDir) return false;
      const resolved = path.resolve(workingDir);
      return resolved === composeDir || resolved.startsWith(composeDir + path.sep);
    };

    const containers = allContainers as Dockerode.ContainerInfo[];
    const active = containers.filter(c => c.State === 'running').length;
    const exited = containers.filter(c => c.State === 'exited').length;
    const total = containers.length;
    const managed = containers.filter(c => c.State === 'running' && isManagedByComposeDir(c)).length;
    const unmanaged = containers.filter(c => c.State === 'running' && !isManagedByComposeDir(c)).length;

    const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:') || fsSize[0];

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      status: 'online',
      stats: { active, managed, unmanaged, exited, total },
      systemStats: {
        cpu: { usage: currentLoad.currentLoad.toFixed(1), cores: currentLoad.cpus.length },
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          usagePercent: ((mem.used / mem.total) * 100).toFixed(1),
        },
        disk: mainDisk ? {
          total: mainDisk.size,
          used: mainDisk.used,
          free: mainDisk.available,
          usagePercent: mainDisk.use ? mainDisk.use.toFixed(1) : '0',
        } : null,
      },
      stacks,
    };
  } catch (error) {
    console.error(`[Fleet] Local node ${node.name} error:`, error);
    return {
      id: node.id, name: node.name, type: node.type, status: 'offline',
      stats: null, systemStats: null, stacks: null,
    };
  }
}

async function fetchRemoteNodeOverview(node: Node): Promise<FleetNodeOverview> {
  if (!node.api_url || !node.api_token) {
    return {
      id: node.id, name: node.name, type: node.type, status: 'offline',
      stats: null, systemStats: null, stacks: null,
    };
  }

  const baseUrl = node.api_url.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${node.api_token}` };

  try {
    const [statsRes, systemStatsRes, stacksRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/stats`, { headers, signal: AbortSignal.timeout(10000) }),
      fetch(`${baseUrl}/api/system/stats`, { headers, signal: AbortSignal.timeout(10000) }),
      fetch(`${baseUrl}/api/stacks`, { headers, signal: AbortSignal.timeout(10000) }),
    ]);

    interface RemoteSystemStats {
      cpu: { usage: string; cores: number };
      memory: { total: number; used: number; free: number; usagePercent: string };
      disk?: { total: number; used: number; free: number; usagePercent: string } | null;
    }

    const stats: FleetNodeOverview['stats'] | null = statsRes.status === 'fulfilled' && statsRes.value.ok
      ? await statsRes.value.json() as FleetNodeOverview['stats'] : null;
    const systemStatsRaw: RemoteSystemStats | null = systemStatsRes.status === 'fulfilled' && systemStatsRes.value.ok
      ? await systemStatsRes.value.json() as RemoteSystemStats : null;
    const stacks: string[] | null = stacksRes.status === 'fulfilled' && stacksRes.value.ok
      ? await stacksRes.value.json() as string[] : null;

    const systemStats: FleetNodeOverview['systemStats'] | null = systemStatsRaw ? {
      cpu: systemStatsRaw.cpu,
      memory: systemStatsRaw.memory,
      disk: systemStatsRaw.disk ? {
        total: systemStatsRaw.disk.total,
        used: systemStatsRaw.disk.used,
        free: systemStatsRaw.disk.free,
        usagePercent: systemStatsRaw.disk.usagePercent,
      } : null,
    } : null;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      status: stats || systemStats ? 'online' : 'offline',
      stats,
      systemStats,
      stacks,
    };
  } catch (error) {
    console.error(`[Fleet] Remote node ${node.name} error:`, error);
    return {
      id: node.id, name: node.name, type: node.type, status: 'offline',
      stats: null, systemStats: null, stacks: null,
    };
  }
}

// ─── Fleet Snapshots (Skipper+) ───

// Create fleet snapshot
app.post('/api/fleet/snapshots', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;

  try {
    const { description = '' } = req.body;
    if (typeof description === 'string' && description.length > 500) {
      res.status(400).json({ error: 'Description must be 500 characters or less' });
      return;
    }
    const db = DatabaseService.getInstance();
    const nodes = db.getNodes();
    const username = req.user?.username || 'admin';

    const captureStart = Date.now();
    const results = await Promise.allSettled(
      nodes.map(async (node) => {
        if (node.type === 'remote') {
          return captureRemoteNodeFiles(node);
        }
        return captureLocalNodeFiles(node);
      })
    );

    const capturedNodes: SnapshotNodeData[] = [];
    const skippedNodes: Array<{ nodeId: number; nodeName: string; reason: string }> = [];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        capturedNodes.push(result.value);
      } else {
        console.error(`[Fleet Snapshot] Failed to capture node ${nodes[i].name}:`, result.reason);
        skippedNodes.push({
          nodeId: nodes[i].id,
          nodeName: nodes[i].name,
          reason: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        });
      }
    });

    let totalStacks = 0;
    const allFiles: Array<{ nodeId: number; nodeName: string; stackName: string; filename: string; content: string }> = [];

    for (const nodeData of capturedNodes) {
      totalStacks += nodeData.stacks.length;
      for (const stack of nodeData.stacks) {
        for (const file of stack.files) {
          allFiles.push({
            nodeId: nodeData.nodeId,
            nodeName: nodeData.nodeName,
            stackName: stack.stackName,
            filename: file.filename,
            content: file.content,
          });
        }
      }
    }

    const snapshotId = db.createSnapshot(
      description,
      username,
      capturedNodes.length,
      totalStacks,
      JSON.stringify(skippedNodes),
    );

    if (allFiles.length > 0) {
      db.insertSnapshotFiles(snapshotId, allFiles);
    }

    console.log('[Fleet] Snapshot created:', capturedNodes.length, 'nodes,', totalStacks, 'stacks');
    if (isDebugEnabled()) {
      console.debug(`[Fleet:debug] Snapshot ${snapshotId} capture completed in ${Date.now() - captureStart}ms, ${allFiles.length} file(s) stored`);
      for (const skip of skippedNodes) {
        console.debug(`[Fleet:debug] Skipped node "${skip.nodeName}" (id=${skip.nodeId}): ${skip.reason}`);
      }
    }
    const snapshot = db.getSnapshot(snapshotId);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('[Fleet Snapshot] Create error:', error);
    res.status(500).json({ error: 'Failed to create fleet snapshot' });
  }
});

// List fleet snapshots
app.get('/api/fleet/snapshots', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;

  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const db = DatabaseService.getInstance();
    const snapshots = db.getSnapshots(limit, offset);
    const total = db.getSnapshotCount();
    if (isDebugEnabled()) console.debug('[Fleet:debug] Snapshots list: limit=', limit, 'offset=', offset, 'total=', total);
    res.json({ snapshots, total });
  } catch (error) {
    console.error('[Fleet Snapshot] List error:', error);
    res.status(500).json({ error: 'Failed to list fleet snapshots' });
  }
});

// Get snapshot detail
app.get('/api/fleet/snapshots/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid snapshot ID' }); return; }
    const db = DatabaseService.getInstance();
    const snapshot = db.getSnapshot(id);
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    const files = db.getSnapshotFiles(id);

    // Group files by node and stack
    const nodesMap = new Map<number, { nodeId: number; nodeName: string; stacks: Map<string, Array<{ filename: string; content: string }>> }>();
    for (const file of files) {
      if (!nodesMap.has(file.node_id)) {
        nodesMap.set(file.node_id, { nodeId: file.node_id, nodeName: file.node_name, stacks: new Map() });
      }
      const nodeEntry = nodesMap.get(file.node_id)!;
      if (!nodeEntry.stacks.has(file.stack_name)) {
        nodeEntry.stacks.set(file.stack_name, []);
      }
      nodeEntry.stacks.get(file.stack_name)!.push({ filename: file.filename, content: file.content });
    }

    const nodes = Array.from(nodesMap.values()).map(n => ({
      nodeId: n.nodeId,
      nodeName: n.nodeName,
      stacks: Array.from(n.stacks.entries()).map(([stackName, stackFiles]) => ({
        stackName,
        files: stackFiles,
      })),
    }));

    if (isDebugEnabled()) console.debug('[Fleet:debug] Snapshot detail:', id, files.length, 'files');
    res.json({ ...snapshot, nodes });
  } catch (error) {
    console.error('[Fleet Snapshot] Detail error:', error);
    res.status(500).json({ error: 'Failed to fetch snapshot details' });
  }
});

// Restore a stack from snapshot
app.post('/api/fleet/snapshots/:id/restore', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;

  try {
    const snapshotId = parseInt(req.params.id as string, 10);
    if (isNaN(snapshotId)) { res.status(400).json({ error: 'Invalid snapshot ID' }); return; }
    const { nodeId, stackName, redeploy = false } = req.body;

    if (!nodeId || !stackName) {
      res.status(400).json({ error: 'nodeId and stackName are required' });
      return;
    }
    if (!isValidStackName(stackName)) {
      res.status(400).json({ error: 'Invalid stack name' });
      return;
    }

    const db = DatabaseService.getInstance();
    const snapshot = db.getSnapshot(snapshotId);
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    const files = db.getSnapshotStackFiles(snapshotId, nodeId, stackName);
    if (files.length === 0) {
      res.status(404).json({ error: 'No files found for this stack in the snapshot' });
      return;
    }

    if (isDebugEnabled()) {
      const fileNames = files.map(f => f.filename).join(', ');
      console.debug(`[Fleet:debug] Restore: snapshot=${snapshotId}, node=${nodeId}, stack="${stackName}", files=[${fileNames}], redeploy=${redeploy}`);
    }

    const node = db.getNode(nodeId);
    if (!node) {
      res.status(404).json({ error: 'Target node no longer exists' });
      return;
    }

    if (node.type === 'local') {
      const fsService = FileSystemService.getInstance(node.id);

      // Backup current files before restore
      try {
        await fsService.backupStackFiles(stackName);
      } catch (e) {
        // Stack may not exist yet before first restore — that's ok
        console.warn(`[Fleet Snapshot] Pre-restore backup failed for stack "${stackName}" (may not exist yet):`, (e as Error).message);
      }

      for (const file of files) {
        if (file.filename === 'compose.yaml') {
          await fsService.saveStackContent(stackName, file.content);
        } else if (file.filename === '.env') {
          await fsService.saveEnvContent(stackName, file.content);
        }
      }

      if (redeploy) {
        const composeService = ComposeService.getInstance(node.id);
        await composeService.deployStack(stackName);
      }
    } else {
      // Remote node
      if (!node.api_url || !node.api_token) {
        res.status(503).json({ error: 'Remote node not configured' });
        return;
      }

      const baseUrl = node.api_url.replace(/\/$/, '');
      const headers: Record<string, string> = {
        Authorization: `Bearer ${node.api_token}`,
        'Content-Type': 'application/json',
      };

      for (const file of files) {
        if (file.filename === 'compose.yaml') {
          const putRes = await fetch(`${baseUrl}/api/stacks/${encodeURIComponent(stackName)}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ content: file.content }),
            signal: AbortSignal.timeout(15000),
          });
          if (!putRes.ok) throw new Error('Failed to restore compose file on remote node');
        } else if (file.filename === '.env') {
          const putRes = await fetch(`${baseUrl}/api/stacks/${encodeURIComponent(stackName)}/env`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ content: file.content }),
            signal: AbortSignal.timeout(15000),
          });
          if (!putRes.ok) throw new Error('Failed to restore env file on remote node');
        }
      }

      if (redeploy) {
        await fetch(`${baseUrl}/api/compose/${encodeURIComponent(stackName)}/up`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(30000),
        });
      }
    }

    console.log('[Fleet] Snapshot restore:', snapshotId, 'node=', nodeId, 'stack=', stackName);
    res.json({ message: 'Stack restored successfully', redeployed: redeploy });
  } catch (error) {
    console.error('[Fleet Snapshot] Restore error:', error);
    res.status(500).json({ error: 'Failed to restore stack from snapshot' });
  }
});

// Delete snapshot
app.delete('/api/fleet/snapshots/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;

  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid snapshot ID' }); return; }
    const db = DatabaseService.getInstance();
    const snapshot = db.getSnapshot(id);
    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }
    if (isDebugEnabled()) {
      console.debug(`[Fleet:debug] Deleting snapshot ${id} (${snapshot.node_count} node(s), ${snapshot.stack_count} stack(s))`);
    }
    db.deleteSnapshot(id);
    console.log('[Fleet] Snapshot deleted:', id);
    res.json({ message: 'Snapshot deleted' });
  } catch (error) {
    console.error('[Fleet Snapshot] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete snapshot' });
  }
});

// ─── Webhooks (Skipper+) ─── CRUD requires auth + paid tier, trigger is public with HMAC ───

// Webhook CRUD (auth + paid tier required)
app.get('/api/webhooks', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  if (!requirePaid(_req, res)) return;
  try {
    const webhooks = DatabaseService.getInstance().getWebhooks();
    const svc = WebhookService.getInstance();
    res.json(webhooks.map(w => ({ ...w, secret: svc.maskSecret(w.secret) })));
  } catch (error) {
    console.error('[Webhooks] List error:', error);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

app.post('/api/webhooks', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const { name, stack_name, action, enabled } = req.body;
    if (!name || !stack_name || !action) {
      res.status(400).json({ error: 'name, stack_name, and action are required' });
      return;
    }
    const validActions = ['deploy', 'restart', 'stop', 'start', 'pull', 'git-pull'];
    if (!validActions.includes(action)) {
      res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
      return;
    }
    if (action === 'git-pull' && !GitSourceService.getInstance().get(stack_name)) {
      res.status(400).json({ error: 'Configure a Git source for this stack before creating a git-pull webhook' });
      return;
    }

    const svc = WebhookService.getInstance();
    const secret = svc.generateSecret();
    const id = DatabaseService.getInstance().addWebhook({
      name, stack_name, action, secret, enabled: enabled !== false,
    });

    // Return the full secret only on creation
    res.status(201).json({ id, secret });
  } catch (error) {
    console.error('[Webhooks] Create error:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

app.put('/api/webhooks/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    const webhook = DatabaseService.getInstance().getWebhook(id);
    if (!webhook) { res.status(404).json({ error: 'Webhook not found' }); return; }

    const { name, stack_name, action, enabled } = req.body;
    const validActions = ['deploy', 'restart', 'stop', 'start', 'pull', 'git-pull'];
    if (action && !validActions.includes(action)) {
      res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
      return;
    }
    if (action === 'git-pull') {
      const targetStack = stack_name || webhook.stack_name;
      if (!GitSourceService.getInstance().get(targetStack)) {
        res.status(400).json({ error: 'Configure a Git source for this stack before enabling a git-pull webhook' });
        return;
      }
    }

    DatabaseService.getInstance().updateWebhook(id, { name, stack_name, action, enabled });
    res.json({ success: true });
  } catch (error) {
    console.error('[Webhooks] Update error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

app.delete('/api/webhooks/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    DatabaseService.getInstance().deleteWebhook(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Webhooks] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

app.get('/api/webhooks/:id/history', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    const executions = DatabaseService.getInstance().getWebhookExecutions(id);
    res.json(executions);
  } catch (error) {
    console.error('[Webhooks] History error:', error);
    res.status(500).json({ error: 'Failed to fetch webhook history' });
  }
});

// Webhook trigger - public endpoint, authenticated via HMAC signature
app.post('/api/webhooks/:id/trigger', webhookTriggerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const db = DatabaseService.getInstance();
    const webhook = db.getWebhook(id);

    if (!webhook || !webhook.enabled) {
      res.status(404).json({ error: 'Webhook not found or disabled' });
      return;
    }

    // Paid tier gate - trigger only works with an active Skipper or Admiral license
    if (LicenseService.getInstance().getTier() !== 'paid') {
      res.status(403).json({ error: 'This feature requires a Skipper or Admiral license.', code: 'PAID_REQUIRED' });
      return;
    }

    // Validate HMAC signature
    const signature = req.headers['x-webhook-signature'] as string;
    if (!signature) {
      res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
      return;
    }

    const rawBody = req.rawBody?.toString('utf-8') ?? JSON.stringify(req.body ?? {});
    const svc = WebhookService.getInstance();
    if (!svc.validateSignature(rawBody, webhook.secret, signature)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Use action from body if provided, otherwise use webhook default
    const action = req.body?.action || webhook.action;
    const triggerSource = req.headers['user-agent'] || req.ip || null;

    // Execute asynchronously - return 202 immediately
    res.status(202).json({ message: 'Webhook accepted', action });

    const atomic = LicenseService.getInstance().getTier() === 'paid';
    svc.execute(id, action, triggerSource, atomic).catch(err => {
      console.error(`[Webhooks] Execution error for webhook ${id}:`, err);
    });
  } catch (error) {
    console.error('[Webhooks] Trigger error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// --- User Management (local-only, admin + paid tier gated for creation) ---

app.get('/api/users', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  try {
    const users = DatabaseService.getInstance().getUsers();
    res.json(users);
  } catch (error) {
    console.error('[Users] List error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      res.status(400).json({ error: 'Username, password, and role are required' });
      return;
    }
    if (typeof username !== 'string' || username.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
      res.status(400).json({ error: 'Username must be at least 3 characters (letters, numbers, underscore, hyphen)' });
      return;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    const validRoles: UserRole[] = ['admin', 'viewer', 'deployer', 'node-admin', 'auditor'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Role must be "admin", "viewer", "deployer", "node-admin", or "auditor"' });
      return;
    }
    if ((role === 'deployer' || role === 'node-admin' || role === 'auditor') && !requireAdmiral(req, res)) return;

    const db = DatabaseService.getInstance();
    const existing = db.getUserByUsername(username);
    if (existing) {
      res.status(409).json({ error: 'A user with this username already exists' });
      return;
    }

    // Enforce seat limits based on license variant
    const seatLimits = LicenseService.getInstance().getSeatLimits();
    if (role === 'admin' && seatLimits.maxAdmins !== null && db.getAdminCount() >= seatLimits.maxAdmins) {
      res.status(403).json({ error: `Your license allows a maximum of ${seatLimits.maxAdmins} admin account${seatLimits.maxAdmins === 1 ? '' : 's'}. Upgrade to Admiral for unlimited accounts.` });
      return;
    }
    if (role !== 'admin' && seatLimits.maxViewers !== null && db.getNonAdminCount() >= seatLimits.maxViewers) {
      res.status(403).json({ error: `Your license allows a maximum of ${seatLimits.maxViewers} viewer account${seatLimits.maxViewers === 1 ? '' : 's'}. Upgrade to Admiral for unlimited accounts.` });
      return;
    }


    const passwordHash = await bcrypt.hash(password, 10);
    const id = db.addUser({ username, password_hash: passwordHash, role });
    console.log('[Users] Created:', username, 'role:', role, 'by:', req.user!.username);
    res.status(201).json({ id, username, role });
  } catch (error) {
    console.error('[Users] Create error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Note: requirePaid is intentionally not enforced on PUT/DELETE user endpoints.
// Admins must be able to manage existing users even if their license lapses (security consideration).
app.put('/api/users/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    const db = DatabaseService.getInstance();
    const user = db.getUser(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { username, password, role } = req.body;
    const updates: Partial<{ username: string; password_hash: string; role: string }> = {};

    if (username !== undefined) {
      if (typeof username !== 'string' || username.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
        res.status(400).json({ error: 'Username must be at least 3 characters (letters, numbers, underscore, hyphen)' });
        return;
      }
      const existing = db.getUserByUsername(username);
      if (existing && existing.id !== id) {
        res.status(409).json({ error: 'A user with this username already exists' });
        return;
      }
      updates.username = username;
    }

    if (role !== undefined) {
      const validRoles: UserRole[] = ['admin', 'viewer', 'deployer', 'node-admin', 'auditor'];
      if (!validRoles.includes(role)) {
        res.status(400).json({ error: 'Role must be "admin", "viewer", "deployer", "node-admin", or "auditor"' });
        return;
      }
      if ((role === 'deployer' || role === 'node-admin' || role === 'auditor') && !requireAdmiral(req, res)) return;
      // Prevent demoting yourself
      if (user.username === req.user!.username && role !== user.role) {
        res.status(400).json({ error: 'Cannot change your own role' });
        return;
      }
      // Prevent removing the last admin
      if (user.role === 'admin' && role !== 'admin' && db.getAdminCount() <= 1) {
        res.status(400).json({ error: 'Cannot demote the only admin user' });
        return;
      }
      updates.role = role;
    }

    if (password !== undefined) {
      // Prevent setting passwords on SSO-provisioned users (would enable local login bypass)
      if (user.auth_provider !== 'local') {
        res.status(400).json({ error: 'Cannot set a password on an SSO-provisioned user.' });
        return;
      }
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        return;
      }
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    db.updateUser(id, updates);
    // Invalidate the user's active sessions when their role or password changes
    if (updates.role || updates.password_hash) {
      db.bumpTokenVersion(id);
    }
    console.log('[Users] Updated user', id, 'fields:', Object.keys(updates).join(', '), 'by:', req.user!.username);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Update error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    const db = DatabaseService.getInstance();
    const user = db.getUser(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Cannot delete yourself
    if (user.username === req.user!.username) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    // Cannot delete the last admin
    if (user.role === 'admin' && db.getAdminCount() <= 1) {
      res.status(400).json({ error: 'Cannot delete the only admin user' });
      return;
    }

    db.deleteUser(id);
    console.log('[Users] Deleted:', user.username, '(id:', id, ') by:', req.user!.username);
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// --- Scoped Role Assignments (Admiral) ---

app.get('/api/users/:id/roles', authMiddleware, (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const userId = parseInt(req.params.id as string, 10);
    const db = DatabaseService.getInstance();
    if (!db.getUser(userId)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const assignments = db.getAllRoleAssignments(userId);
    res.json(assignments);
  } catch (error) {
    console.error('[Roles] List error:', error);
    res.status(500).json({ error: 'Failed to fetch role assignments' });
  }
});

app.post('/api/users/:id/roles', authMiddleware, (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const userId = parseInt(req.params.id as string, 10);
    const { role, resource_type, resource_id } = req.body;

    const validRoles: UserRole[] = ['admin', 'viewer', 'deployer', 'node-admin'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    const validResourceTypes: ResourceType[] = ['stack', 'node'];
    if (!validResourceTypes.includes(resource_type)) {
      res.status(400).json({ error: 'Invalid resource type' });
      return;
    }
    if (!resource_id || typeof resource_id !== 'string') {
      res.status(400).json({ error: 'resource_id is required' });
      return;
    }

    const db = DatabaseService.getInstance();
    if (!db.getUser(userId)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    try {
      const id = db.addRoleAssignment({ user_id: userId, role, resource_type, resource_id });
      console.log('[Roles] Assigned', role, 'on', resource_type, resource_id, 'to user', userId, 'by:', req.user!.username);
      res.status(201).json({ id, user_id: userId, role, resource_type, resource_id });
    } catch (err: unknown) {
      if ((err as Error).message?.includes('UNIQUE constraint')) {
        res.status(409).json({ error: 'This role assignment already exists' });
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error('[Roles] Create error:', error);
    res.status(500).json({ error: 'Failed to add role assignment' });
  }
});

app.delete('/api/users/:id/roles/:assignId', authMiddleware, (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const userId = parseInt(req.params.id as string, 10);
    const assignId = parseInt(req.params.assignId as string, 10);
    const db = DatabaseService.getInstance();

    const assignment = db.getRoleAssignmentById(assignId);
    if (!assignment || assignment.user_id !== userId) {
      res.status(404).json({ error: 'Role assignment not found' });
      return;
    }

    db.deleteRoleAssignment(assignId);
    console.log('[Roles] Removed assignment', assignId, 'from user', userId, 'by:', req.user!.username);
    res.json({ success: true });
  } catch (error) {
    console.error('[Roles] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete role assignment' });
  }
});

// Return the current user's effective permissions (any authenticated user)
app.get('/api/permissions/me', authMiddleware, (req: Request, res: Response): void => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const db = DatabaseService.getInstance();
    const globalRole = req.user.role;
    const globalPermissions = ROLE_PERMISSIONS[globalRole] || [];
    const assignments = db.getAllRoleAssignments(req.user.userId);

    const scopedPermissions: Record<string, PermissionAction[]> = {};
    for (const a of assignments) {
      const key = `${a.resource_type}:${a.resource_id}`;
      const perms = ROLE_PERMISSIONS[a.role] || [];
      const existing = scopedPermissions[key] || [];
      scopedPermissions[key] = [...new Set([...existing, ...perms])];
    }

    res.json({
      globalRole,
      globalPermissions,
      scopedPermissions,
      isAdmiral: LicenseService.getInstance().getVariant() === 'admiral',
    });
  } catch (error) {
    console.error('[Permissions] Error:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Remote Node HTTP Proxy - single global instance.
// Previously, createProxyMiddleware was called inside the request handler on every API
// call, spawning a new proxy instance (and http-proxy server) each time. This caused:
//   - MaxListenersExceededWarning: repeated 'close' listeners added to [Server]
//   - DEP0060: util._extend called on every http-proxy initialisation
// Fix: create ONE instance at startup; use the router option to resolve the
// target URL dynamically per request without constructing new listeners.
const remoteNodeProxy = createProxyMiddleware<Request, Response>({
  target: 'http://localhost:0', // placeholder - overridden per-request by router
  changeOrigin: true,
  router: (req) => {
    const node = NodeRegistry.getInstance().getNode(req.nodeId);
    return node?.api_url?.replace(/\/$/, '');
  },
  // When mounted at app.use('/api/', ...), Express strips the '/api/' prefix from
  // req.url before the middleware sees it. Re-add it so the remote Sencho instance
  // receives the full path (e.g. '/stats' becomes '/api/stats').
  pathRewrite: (path) => '/api' + path,
  on: {
    proxyReq: (proxyReq, req) => {
      const node = NodeRegistry.getInstance().getNode(req.nodeId);
      // Strip headers that must not reach the remote instance:
      // - x-node-id: remote Sencho treats all requests as local
      // - cookie: the browser's sencho_token is signed with THIS instance's JWT secret;
      //   the remote would try to verify it with its own secret and return 401.
      //   Authentication is handled exclusively via the Bearer token below.
      proxyReq.removeHeader('x-node-id');
      proxyReq.removeHeader('cookie');
      if (node?.api_token) {
        proxyReq.setHeader('Authorization', `Bearer ${node.api_token}`);
      }
      // Distributed License Enforcement: assert the main instance's license tier to the
      // remote node so tier-gated routes honor the main's license instead of the node's local
      // (likely Community) tier. The remote's authMiddleware only trusts these headers when the
      // request carries a valid node_proxy JWT.
      const proxyLs = LicenseService.getInstance();
      proxyReq.setHeader(PROXY_TIER_HEADER, proxyLs.getTier());
      proxyReq.setHeader(PROXY_VARIANT_HEADER, proxyLs.getVariant() || '');
      // Strip the ?nodeId= query param so the remote's nodeContextMiddleware
      // doesn't reject the request with 404 ("Node X not found") - the remote
      // has no record of the gateway's node IDs and should treat the request
      // as local. This affects endpoints like EventSource /api/containers/:id/logs
      // that pass nodeId as a query param rather than the x-node-id header.
      if (proxyReq.path.includes('nodeId=')) {
        const [pathname, qs] = proxyReq.path.split('?');
        const params = new URLSearchParams(qs || '');
        params.delete('nodeId');
        const newQs = params.toString();
        proxyReq.path = pathname + (newQs ? `?${newQs}` : '');
      }
      // Body forwarding: the conditional json parser (see top of file) skips
      // parsing for remote requests, so req's raw stream is intact and
      // http-proxy's req.pipe(proxyReq) forwards the body automatically.
      // No manual body rewriting needed here.
    },
    proxyRes: (proxyRes) => {
      // Mark every response forwarded from a remote node with a sentinel header.
      // The frontend (apiFetch / fetchForNode) checks this before firing the
      // global 'sencho-unauthorized' event: a 401 from a remote means the stored
      // api_token for that node is invalid - not that the user's own session
      // expired. Without this distinction, any node with a bad token causes an
      // immediate logout loop.
      proxyRes.headers['x-sencho-proxy'] = '1';
    },
    error: (err, _req, proxyRes) => {
      console.error('[Proxy] Remote node error:', (err as Error).message);
      // proxyRes can be either a ServerResponse (HTTP) or a raw Socket (WS/TCP errors).
      // Only attempt to send an HTTP 502 if it is a proper ServerResponse with a
      // headersSent flag - otherwise silently drop (the socket will be destroyed).
      const res = proxyRes as any;
      if (typeof res?.headersSent === 'boolean' && !res.headersSent && typeof res.status === 'function') {
        res.status(502).json({
          error: 'Remote node is unreachable. Check the API URL and ensure Sencho is running on that host.'
        });
      }
    },
  },
});

// Intercepts all /api/ requests for remote Distributed API nodes and forwards them
// to the target Sencho instance. Node management and auth routes always execute locally.
app.use('/api/', (req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/auth/') || req.path.startsWith('/nodes') || req.path.startsWith('/license') || req.path.startsWith('/fleet') || req.path.startsWith('/webhooks') || req.path.startsWith('/meta')) {
    next();
    return;
  }

  const node = NodeRegistry.getInstance().getNode(req.nodeId);
  if (!node || node.type !== 'remote') {
    next();
    return;
  }

  if (!node.api_url || !node.api_token) {
    res.status(503).json({
      error: `Remote node "${node.name}" has no API URL or token configured. Update it in Settings → Nodes.`
    });
    return;
  }

  remoteNodeProxy(req, res, next);
});

// Create HTTP server for WebSocket upgrade handling
const server = http.createServer(app);

// WebSocket server with authentication
const wss = new WebSocketServer({ noServer: true });

let terminalWs: WebSocket | null = null;

// Notification push - set of authenticated browser clients subscribed to real-time alerts
const notificationSubscribers = new Set<WebSocket>();
NotificationService.getInstance().setBroadcaster((notification) => {
  if (notificationSubscribers.size === 0) return;
  const msg = JSON.stringify({ type: 'notification', payload: notification });
  for (const ws of notificationSubscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
});

// Handle WebSocket upgrade with JWT authentication
server.on('upgrade', async (req, socket, head) => {
  // Parse cookies from the upgrade request
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=')).filter(([k, v]) => k && v)
  );

  // Accept either cookie auth (browser sessions) or Bearer token auth (node-to-node WS proxy)
  const cookieToken = cookies[COOKIE_NAME];
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  // Prefer Bearer over cookie: node-to-node proxy upgrades carry a Bearer token and must
  // not be shadowed by a browser cookie signed with a different instance's JWT secret.
  const token = bearerToken || cookieToken;

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) throw new Error('No JWT secret');
    const decoded = jwt.verify(token, jwtSecret) as { username?: string; scope?: string; role?: string; tv?: number };

    // Node proxy tokens are machine-to-machine credentials and must never be granted
    // interactive terminal access (host console or container exec).
    const isProxyToken = decoded.scope === 'node_proxy';

    // API token scope enforcement for WebSocket connections
    let wsApiTokenScope: string | null = null;
    if (decoded.scope === 'api_token') {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const apiToken = DatabaseService.getInstance().getApiTokenByHash(tokenHash);
      if (!apiToken || apiToken.revoked_at) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (apiToken.expires_at && apiToken.expires_at < Date.now()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      DatabaseService.getInstance().updateApiTokenLastUsed(apiToken.id);
      wsApiTokenScope = apiToken.scope;
    }

    // For user session tokens (no scope), resolve against DB for up-to-date role and
    // token_version checks. This mirrors what authMiddleware does for HTTP requests.
    // Scoped tokens (api_token, node_proxy, console_session) skip this: they are
    // validated by their own logic above or by the gateway that issued them.
    let wsResolvedUser: { username: string; role: UserRole; token_version: number } | undefined;
    if (!decoded.scope && decoded.username) {
      const dbUser = DatabaseService.getInstance().getUserByUsername(decoded.username);
      if (!dbUser) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (decoded.tv !== undefined && dbUser.token_version !== decoded.tv) {
        console.log('[Auth] WS session rejected: token version mismatch for:', decoded.username);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wsResolvedUser = { username: dbUser.username, role: dbUser.role as UserRole, token_version: dbUser.token_version };
    }

    const url = req.url || '';
    const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Gate WebSocket paths by API token scope
    if (wsApiTokenScope) {
      const isLogPath = /^\/api\/stacks\/[^/]+\/logs$/.test(pathname);
      const isNotifPath = pathname === '/ws/notifications';
      if (wsApiTokenScope === 'read-only' || wsApiTokenScope === 'deploy-only') {
        if (!isLogPath && !isNotifPath) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }
    }

    // Resolve node context from query param
    const nodeIdParam = parsedUrl.searchParams.get('nodeId');
    const nodeId = nodeIdParam ? parseInt(nodeIdParam, 10) : NodeRegistry.getInstance().getDefaultNodeId();
    const node = NodeRegistry.getInstance().getNode(nodeId);

    // Notification push channel - local only when no remote nodeId is specified.
    // When a nodeId pointing to a remote node is provided, fall through to the
    // proxy block below so the browser subscribes to that remote node's push stream.
    if (pathname === '/ws/notifications' && (!node || node.type !== 'remote')) {
      const notifWss = new WebSocketServer({ noServer: true });
      notifWss.handleUpgrade(req, socket, head, (ws) => {
        notifWss.close();
        notificationSubscribers.add(ws);
        ws.on('close', () => notificationSubscribers.delete(ws));
        ws.on('error', () => { notificationSubscribers.delete(ws); ws.terminate(); });
      });
      return;
    }

    // Remote Node WebSocket Proxy - forward the entire WS connection to the remote Sencho instance
    if (node && node.type === 'remote' && node.api_url && node.api_token) {
      const wsTarget = node.api_url.replace(/\/$/, '').replace(/^https?/, (m) => m === 'https' ? 'wss' : 'ws');

      // Interactive console paths (host console / container exec) are guarded on the remote by
      // an isProxyToken check that rejects the long-lived api_token (scope: 'node_proxy').
      // Exchange it for a short-lived console_session token before forwarding so the remote
      // allows the connection while keeping the guard intact for direct api_token access.
      const isInteractiveConsolePath = pathname === '/api/system/host-console' || pathname === '/ws';
      let bearerTokenForProxy = node.api_token;
      if (isInteractiveConsolePath) {
        try {
          const ls = LicenseService.getInstance();
          const tokenRes = await fetch(`${node.api_url.replace(/\/$/, '')}/api/system/console-token`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${node.api_token}`,
              [PROXY_TIER_HEADER]: ls.getTier(),
              [PROXY_VARIANT_HEADER]: ls.getVariant() || '',
            },
          });
          if (tokenRes.ok) {
            const data = await tokenRes.json() as { token?: string };
            if (typeof data.token === 'string') bearerTokenForProxy = data.token;
          } else {
            console.error(`[WS Proxy] Remote console-token request failed: ${tokenRes.status}`);
            socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch (e) {
          console.error('[WS Proxy] Failed to fetch remote console token:', (e as Error).message);
          socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      req.headers['authorization'] = `Bearer ${bearerTokenForProxy}`;
      delete req.headers['x-node-id'];
      // Strip the browser's session cookie - it is signed by this instance's JWT secret and
      // would fail verification on the remote. Auth is handled exclusively via the Bearer token.
      delete req.headers['cookie'];
      // Distributed License Enforcement: assert the main's license tier on proxied WS connections.
      const wsLs = LicenseService.getInstance();
      req.headers[PROXY_TIER_HEADER] = wsLs.getTier();
      req.headers[PROXY_VARIANT_HEADER] = wsLs.getVariant() || '';
      // Strip nodeId from the forwarded URL so the remote treats the request as a local one.
      // The remote has no record of the gateway's nodeId, so leaving it would cause unnecessary
      // fallback logic. Removing it lets the remote default cleanly to its own local node.
      const fwdUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      fwdUrl.searchParams.delete('nodeId');
      req.url = fwdUrl.pathname + (fwdUrl.searchParams.toString() ? `?${fwdUrl.searchParams.toString()}` : '');
      wsProxyServer.ws(req, socket, head, { target: wsTarget });
      return;
    }

    // Local node handling
    const logsMatch = pathname.match(/^\/api\/stacks\/([^/]+)\/logs$/);
    const hostConsoleMatch = pathname.match(/^\/api\/system\/host-console/);

    if (logsMatch) {
      // Dedicated stack logs WebSocket - uses Supervisor loop for persistent logs
      const logsWss = new WebSocketServer({ noServer: true });
      logsWss.handleUpgrade(req, socket, head, (ws) => {
        // Close the per-connection server immediately after the upgrade is complete.
        // The wss instance is only needed to negotiate the handshake; keeping it open
        // would accumulate listeners and allocate memory for every connection.
        logsWss.close();
        const stackName = decodeURIComponent(logsMatch[1]);
        if (!isValidStackName(stackName)) {
          ws.send('Error: Invalid stack name\r\n');
          ws.close();
          return;
        }
        try {
          if (isDebugEnabled()) console.debug('[Stacks:debug] WS log stream opened', { stackName, nodeId });
          ws.on('close', () => {
            if (isDebugEnabled()) console.debug('[Stacks:debug] WS log stream closed', { stackName, nodeId });
          });
          ComposeService.getInstance(nodeId).streamLogs(stackName, ws);
        } catch (error) {
          console.error('[Stacks] Failed to stream logs:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(`Error streaming logs: ${(error as Error).message}\n`);
          }
        }
      });
    } else if (hostConsoleMatch) {
      // Node proxy tokens must not access interactive host terminals
      if (isProxyToken) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      // RBAC gate: only users with 'system:console' permission may access the host console.
      // Console_session tokens are pre-validated by the gateway's requireAdmin() middleware,
      // so they skip this check. API tokens are already blocked by the scope gate above.
      const isConsoleSession = decoded.scope === 'console_session';
      if (!isConsoleSession) {
        const userRole = wsResolvedUser?.role;
        if (!userRole || !ROLE_PERMISSIONS[userRole]?.includes('system:console')) {
          console.log('[HostConsole] Access denied: insufficient permissions', { username: wsResolvedUser?.username || decoded.username, role: userRole });
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      // Admiral license gate: host console requires Admiral (paid + team variant).
      // For proxied connections (console_session tokens), trust the tier headers sent by the gateway;
      // for direct connections, check the local LicenseService.
      const consoleTierHeader = req.headers[PROXY_TIER_HEADER] as string | undefined;
      const consoleVariantHeader = req.headers[PROXY_VARIANT_HEADER] as string | undefined;
      const ls = LicenseService.getInstance();
      const consoleTier = (isConsoleSession && isLicenseTier(consoleTierHeader))
        ? normalizeTier(consoleTierHeader)
        : ls.getTier();
      const consoleVariant = (isConsoleSession && consoleVariantHeader !== undefined && isLicenseVariant(consoleVariantHeader))
        ? normalizeVariant(consoleVariantHeader)
        : ls.getVariant();
      if (consoleTier !== 'paid' || consoleVariant !== 'admiral') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const consoleUsername = wsResolvedUser?.username || decoded.username || 'console_session';
      const stackParam = parsedUrl.searchParams.get('stack');
      console.log('[HostConsole] WebSocket upgrade accepted', { username: consoleUsername, nodeId, stack: stackParam || '(root)' });
      const hostConsoleWss = new WebSocketServer({ noServer: true });
      hostConsoleWss.handleUpgrade(req, socket, head, (ws) => {
        hostConsoleWss.close();
        let targetDirectory = '';
        try {
          const baseDir = FileSystemService.getInstance(nodeId).getBaseDir();
          if (stackParam) {
            const resolved = path.resolve(baseDir, stackParam);
            if (!resolved.startsWith(path.resolve(baseDir))) {
              ws.send('Error: Invalid stack path\r\n');
              ws.close();
              return;
            }
            targetDirectory = resolved;
          } else {
            targetDirectory = baseDir;
          }
        } catch (e) {
          targetDirectory = FileSystemService.getInstance(NodeRegistry.getInstance().getDefaultNodeId()).getBaseDir();
        }
        try {
          HostTerminalService.spawnTerminal(ws, targetDirectory, consoleUsername);
        } catch (error) {
          console.error('[HostConsole] Unhandled spawn error:', { user: consoleUsername, error: (error as Error).message });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('Error: Failed to start terminal session.\r\n');
            ws.close();
          }
        }
      });
    } else {
      // Generic terminal WebSocket (container exec)
      // Node proxy tokens must not access interactive container terminals
      if (isProxyToken) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      // Admin enforcement: container exec requires admin role.
      // console_session tokens are already admin-gated at creation time.
      // API tokens reaching this point have full-admin scope (read-only/deploy-only blocked above).
      if (!decoded.scope) {
        // User session token: verify admin role against the database (not the JWT)
        // so role changes take effect immediately, matching authMiddleware behavior.
        const execUser = decoded.username ? DatabaseService.getInstance().getUserByUsername(decoded.username) : undefined;
        if (!execUser) {
          console.warn('[Exec] User account not found:', decoded.username);
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        if (decoded.tv !== undefined && execUser.token_version !== decoded.tv) {
          console.warn('[Exec] Session invalidated (token version mismatch):', decoded.username);
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        if (execUser.role !== 'admin') {
          console.warn('[Exec] Non-admin user rejected:', decoded.username);
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      if (isDebugEnabled()) console.debug('[Exec:diag] WS upgrade for exec path', { nodeId, username: decoded.username, scope: decoded.scope || 'user-session' });
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  } catch (error) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
});

wss.on('connection', (ws) => {
  console.log('WebSocket connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Only handle 'action'-based messages at the global level.
      // 'type'-based messages (input, resize, ping) are handled by the
      // per-session listener registered inside execContainer's closure.
      if (!data.action) return;

      if (data.action === 'connectTerminal') {
        terminalWs = ws;
      } else if (data.action === 'streamStats') {
        const requestedId = data.nodeId ? parseInt(data.nodeId, 10) : NodeRegistry.getInstance().getDefaultNodeId();
        // When a WS is proxied from a gateway to this remote instance, the nodeId in the
        // message belongs to the gateway's DB and won't resolve locally. Fall back to local.
        let nodeId = requestedId;
        try { NodeRegistry.getInstance().getDocker(requestedId); } catch { nodeId = NodeRegistry.getInstance().getDefaultNodeId(); }
        DockerController.getInstance(nodeId).streamStats(data.containerId, ws).catch((err: Error) => {
          console.error('[WS] streamStats error:', err.message);
          if (ws.readyState === WebSocket.OPEN) ws.close();
        });
      } else if (data.action === 'execContainer') {
        // Handle container exec for bash access
        // Input, resize, and cleanup are handled inside execContainer's closure
        const requestedId = data.nodeId ? parseInt(data.nodeId, 10) : NodeRegistry.getInstance().getDefaultNodeId();
        let nodeId = requestedId;
        try { NodeRegistry.getInstance().getDocker(requestedId); } catch { nodeId = NodeRegistry.getInstance().getDefaultNodeId(); }
        DockerController.getInstance(nodeId).execContainer(data.containerId, ws).catch((err: Error) => {
          console.error('[WS] execContainer error:', err.message);
          if (ws.readyState === WebSocket.OPEN) ws.close();
        });
      }
    } catch (error) {
      // Malformed JSON - ignore silently
    }
  });
});

// API Routes (all protected by authMiddleware)

app.get('/api/containers', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getRunningContainers();
    res.json(containers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch containers' });
  }
});

app.get('/api/ports/in-use', async (req: Request, res: Response) => {
  try {
    const fsService = FileSystemService.getInstance(req.nodeId);
    const stacks = await fsService.getStacks();
    const dockerController = DockerController.getInstance(req.nodeId);
    const portsInUse = await dockerController.getPortsInUse(stacks);
    res.json(portsInUse);
  } catch (error) {
    console.error('[Ports] Failed to fetch ports in use:', error);
    res.status(500).json({ error: 'Failed to fetch ports in use' });
  }
});

// --- Label Routes (Skipper+) ---

app.get('/api/labels', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  try {
    const nodeId = req.nodeId ?? 0;
    const labels = DatabaseService.getInstance().getLabels(nodeId);
    if (isDebugEnabled()) console.debug('[Labels:debug] List labels: nodeId=', nodeId, 'count=', labels.length);
    res.json(labels);
  } catch (error) {
    console.error('[Labels] List error:', error);
    res.status(500).json({ error: 'Failed to list labels' });
  }
});

app.post('/api/labels', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  if (!requireBody(req, res)) return;
  try {
    const nodeId = req.nodeId ?? 0;
    const { name, color } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 30) {
      res.status(400).json({ error: 'name is required and must be 1-30 characters' });
      return;
    }
    if (!/^[a-zA-Z0-9 -]+$/.test(name)) {
      res.status(400).json({ error: 'name may only contain letters, numbers, spaces, and hyphens' });
      return;
    }
    if (!color || !(VALID_LABEL_COLORS as readonly string[]).includes(color)) {
      res.status(400).json({ error: `color must be one of: ${VALID_LABEL_COLORS.join(', ')}` });
      return;
    }

    const db = DatabaseService.getInstance();
    if (db.getLabelCount(nodeId) >= MAX_LABELS_PER_NODE) {
      res.status(409).json({ error: `Maximum of ${MAX_LABELS_PER_NODE} labels per node reached` });
      return;
    }

    if (isDebugEnabled()) console.debug('[Labels:debug] Create label:', { nodeId, name: name.trim(), color });
    const label = db.createLabel(nodeId, name.trim(), color);
    if (isDebugEnabled()) console.debug('[Labels:debug] Created label:', label.id);
    res.status(201).json(label);
  } catch (error: unknown) {
    if (isSqliteUniqueViolation(error)) {
      res.status(409).json({ error: 'A label with that name already exists' });
      return;
    }
    console.error('[Labels] Create error:', error);
    res.status(500).json({ error: 'Failed to create label' });
  }
});

app.get('/api/labels/assignments', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  try {
    const nodeId = req.nodeId ?? 0;
    const db = DatabaseService.getInstance();
    const assignments = db.getLabelsForStacks(nodeId);

    // Opportunistic cleanup: only scan the filesystem when there are assignments to validate
    const assignedStacks = Object.keys(assignments);
    if (assignedStacks.length > 0) {
      const fsStacks = await FileSystemService.getInstance(nodeId).getStacks();
      const fsSet = new Set(fsStacks);
      const staleNames = assignedStacks.filter(name => !fsSet.has(name));
      if (staleNames.length > 0) {
        db.cleanupStaleAssignments(nodeId, fsStacks);
        for (const name of staleNames) {
          delete assignments[name];
        }
        if (isDebugEnabled()) console.debug('[Labels:debug] Cleaned up stale assignments:', staleNames);
      }
    }

    if (isDebugEnabled()) console.debug('[Labels:debug] Assignments: nodeId=', nodeId, 'stacks=', Object.keys(assignments).length);
    res.json(assignments);
  } catch (error) {
    console.error('[Labels] Assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch label assignments' });
  }
});

app.put('/api/labels/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  if (!requireBody(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid label ID' }); return; }
    const nodeId = req.nodeId ?? 0;
    const { name, color } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 30) {
        res.status(400).json({ error: 'name must be 1-30 characters' });
        return;
      }
      if (!/^[a-zA-Z0-9 -]+$/.test(name)) {
        res.status(400).json({ error: 'name may only contain letters, numbers, spaces, and hyphens' });
        return;
      }
    }
    if (color !== undefined && !(VALID_LABEL_COLORS as readonly string[]).includes(color)) {
      res.status(400).json({ error: `color must be one of: ${VALID_LABEL_COLORS.join(', ')}` });
      return;
    }

    if (isDebugEnabled()) console.debug('[Labels:debug] Update label:', { id, nodeId, name: name?.trim(), color });
    const updated = DatabaseService.getInstance().updateLabel(id, nodeId, {
      name: name?.trim(),
      color,
    });
    if (!updated) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }
    res.json(updated);
  } catch (error: unknown) {
    if (isSqliteUniqueViolation(error)) {
      res.status(409).json({ error: 'A label with that name already exists' });
      return;
    }
    console.error('[Labels] Update error:', error);
    res.status(500).json({ error: 'Failed to update label' });
  }
});

app.delete('/api/labels/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid label ID' }); return; }
    const nodeId = req.nodeId ?? 0;
    if (isDebugEnabled()) console.debug('[Labels:debug] Delete label:', { id, nodeId });
    DatabaseService.getInstance().deleteLabel(id, nodeId);
    res.json({ success: true });
  } catch (error) {
    console.error('[Labels] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

app.put('/api/stacks/:stackName/labels', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  if (!requireBody(req, res)) return;
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      res.status(400).json({ error: 'Invalid stack name' });
      return;
    }
    const nodeId = req.nodeId ?? 0;
    const { labelIds } = req.body;

    if (!Array.isArray(labelIds) || !labelIds.every((id: unknown) => typeof id === 'number')) {
      res.status(400).json({ error: 'labelIds must be an array of numbers' });
      return;
    }

    if (isDebugEnabled()) console.debug('[Labels:debug] Set stack labels:', { stackName, nodeId, labelIds });
    DatabaseService.getInstance().setStackLabels(stackName, nodeId, labelIds);
    res.json({ success: true });
  } catch (error) {
    console.error('[Labels] Set stack labels error:', error);
    res.status(500).json({ error: 'Failed to set stack labels' });
  }
});

const activeBulkActions = new Set<string>();

app.post('/api/labels/:id/action', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requirePaid(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (!requireBody(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid label ID' }); return; }
    const { action } = req.body;
    const validActions = ['deploy', 'stop', 'restart'];
    if (!action || !validActions.includes(action)) {
      res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
      return;
    }

    const nodeId = req.nodeId ?? 0;

    const label = DatabaseService.getInstance().getLabel(id, nodeId);
    if (!label) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }

    const lockKey = `bulk:${nodeId}`;
    if (activeBulkActions.has(lockKey)) {
      res.status(429).json({ error: 'A bulk action is already running for this node. Please wait.' });
      return;
    }
    activeBulkActions.add(lockKey);

    try {
      const stackNames = DatabaseService.getInstance().getStacksForLabel(id, nodeId);
      const fsStacks = await FileSystemService.getInstance(nodeId).getStacks();
      const fsStackNames = new Set(fsStacks);
      const validStacks = stackNames.filter(name => fsStackNames.has(name));

      if (isDebugEnabled()) console.debug('[Labels:debug] Bulk action start:', { id, action, nodeId, totalLabeled: stackNames.length, validStacks: validStacks.length });

      const results: { stackName: string; success: boolean; error?: string }[] = [];

      for (const stackName of validStacks) {
        try {
          if (action === 'deploy') {
            await ComposeService.getInstance(req.nodeId).deployStack(stackName, undefined, false);
          } else {
            const dockerController = DockerController.getInstance(req.nodeId);
            const containers = await dockerController.getContainersByStack(stackName);
            if (action === 'stop') {
              await Promise.all(containers.map(c => dockerController.stopContainer(c.Id)));
            } else {
              await Promise.all(containers.map(c => dockerController.restartContainer(c.Id)));
            }
          }
          results.push({ stackName, success: true });
        } catch (err: unknown) {
          results.push({ stackName, success: false, error: (err as Error)?.message || 'Unknown error' });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.length - succeeded;
      console.log(`[Labels] Bulk ${action} on label ${id}: ${validStacks.length} stacks (${succeeded} succeeded, ${failed} failed)`);
      if (isDebugEnabled()) console.debug('[Labels:debug] Bulk action complete:', { id, action, total: results.length, succeeded, failed });

      if (succeeded > 0) {
        invalidateNodeCaches(req.nodeId);
      }
      res.json({ results });
    } finally {
      activeBulkActions.delete(lockKey);
    }
  } catch (error) {
    console.error('[Labels] Bulk action error:', error);
    res.status(500).json({ error: 'Failed to execute bulk action' });
  }
});

// Stack Routes - Updated to use stackName (directory name) instead of filename

app.get('/api/stacks', async (req: Request, res: Response) => {
  try {
    const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    res.json(stacks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stacks' });
  }
});

app.get('/api/stacks/statuses', async (req: Request, res: Response) => {
  try {
    const result = await CacheService.getInstance().getOrFetch(
      `stack-statuses:${req.nodeId}`,
      STACK_STATUSES_CACHE_TTL_MS,
      async () => {
        const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
        const stackNames = stacks.map((s: string) => s.replace(/\.(yml|yaml)$/, ''));
        const dockerController = DockerController.getInstance(req.nodeId);
        const bulkInfo = await dockerController.getBulkStackStatuses(stackNames);
        // Map back to filenames to match frontend expectations
        const data: Record<string, { status: 'running' | 'exited' | 'unknown'; mainPort?: number }> = {};
        for (const stack of stacks) {
          const name = stack.replace(/\.(yml|yaml)$/, '');
          data[stack] = bulkInfo[name] ?? { status: 'unknown' };
        }
        return data;
      },
    );
    res.json(result);
  } catch (error) {
    console.error('Failed to fetch stack statuses:', error);
    res.status(500).json({ error: 'Failed to fetch stack statuses' });
  }
});

app.get('/api/stacks/:stackName', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const content = await FileSystemService.getInstance(req.nodeId).getStackContent(stackName);
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read stack' });
  }
});

app.put('/api/stacks/:stackName', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      console.error('Content is not a string:', content);
      return res.status(400).json({ error: 'Content must be a string' });
    }
    await FileSystemService.getInstance(req.nodeId).saveStackContent(stackName, content);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Compose file saved: ${stackName}`);
    res.json({ message: 'Stack saved successfully' });
  } catch (error) {
    console.error('Failed to save stack:', error);
    res.status(500).json({ error: 'Failed to save stack' });
  }
});

// Helper: resolve all env file paths dynamically from compose.yaml's env_file field
async function resolveAllEnvFilePaths(nodeId: number, stackName: string): Promise<string[]> {
  const fsService = FileSystemService.getInstance(nodeId);
  const stackDir = path.join(fsService.getBaseDir(), stackName);
  const defaultEnvPath = path.join(stackDir, '.env');

  try {
    // Try to read and parse the compose file
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
    let composeContent: string | null = null;

    for (const file of composeFiles) {
      try {
        composeContent = await fsService.readFile(path.join(stackDir, file), 'utf-8');
        break;
      } catch {
        // Try next file
      }
    }

    if (!composeContent) return [defaultEnvPath];

    const parsed = YAML.parse(composeContent);
    if (!parsed?.services) return [defaultEnvPath];

    const envFiles = new Set<string>();

    // Iterate through all services and collect every env_file declaration
    for (const serviceName of Object.keys(parsed.services)) {
      const service = parsed.services[serviceName];
      if (!service?.env_file) continue;

      const addEnvPath = (rawPath: string) => {
        const resolved = path.resolve(stackDir, rawPath);
        if (!isPathWithinBase(resolved, stackDir)) return;
        envFiles.add(resolved);
      };

      if (typeof service.env_file === 'string') {
        addEnvPath(service.env_file);
      } else if (Array.isArray(service.env_file)) {
        for (const entry of service.env_file) {
          const entryPath = typeof entry === 'string' ? entry : (entry?.path || '');
          if (entryPath) addEnvPath(entryPath);
        }
      }
    }

    if (envFiles.size === 0) {
      envFiles.add(defaultEnvPath);
    }

    // Filter to only include files that actually exist on disk
    const existing: string[] = [];
    for (const f of envFiles) {
      try {
        await fsService.access(f);
        existing.push(f);
      } catch {
        // File does not exist - skip
      }
    }
    return existing;
  } catch (error) {
    console.warn(`Could not parse compose.yaml for env_file resolution in stack "${stackName}":`, error);
  }

  // Fallback: return default only if it exists
  try {
    await fsService.access(defaultEnvPath);
    return [defaultEnvPath];
  } catch {
    return [];
  }
}

app.get('/api/stacks/:stackName/envs', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const envPaths = await resolveAllEnvFilePaths(req.nodeId, stackName);
    res.json({ envFiles: envPaths });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve env files' });
  }
});

app.get('/api/stacks/:stackName/env', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const requestedFile = req.query.file as string | undefined;
    const envPaths = await resolveAllEnvFilePaths(req.nodeId, stackName);

    let envPath = envPaths[0]; // Fallback to the first

    if (requestedFile) {
      // Validate that the requested file exists in the allowed resolved list
      if (envPaths.includes(requestedFile)) {
        envPath = requestedFile;
      } else {
        return res.status(400).json({ error: 'Requested env file not allowed' });
      }
    }

    const fsService = FileSystemService.getInstance(req.nodeId);

    try {
      await fsService.access(envPath);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.error('[Sencho] Unexpected error checking env file existence:', (e as Error).message);
      }
      return res.status(404).json({ error: 'Env file not found' });
    }

    const content = await fsService.readFile(envPath, 'utf-8');
    res.send(content);
  } catch (error) {
    console.error('Failed to read env file:', error);
    res.status(500).json({ error: 'Failed to read env file' });
  }
});

app.put('/api/stacks/:stackName/env', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }

    const requestedFile = req.query.file as string | undefined;
    const envPaths = await resolveAllEnvFilePaths(req.nodeId, stackName);

    let envPath = envPaths[0]; // Fallback

    if (requestedFile) {
      if (envPaths.includes(requestedFile)) {
        envPath = requestedFile;
      } else {
        return res.status(400).json({ error: 'Requested env file not allowed' });
      }
    }

    const fsService = FileSystemService.getInstance(req.nodeId);
    await fsService.writeFile(envPath, content, 'utf-8');
    invalidateNodeCaches(req.nodeId);
    const envFileName = path.basename(envPath);
    console.log(`[Stacks] Env file saved: ${stackName}/${envFileName}`);
    res.json({ message: 'Env file saved successfully' });
  } catch (error) {
    console.error('[Stacks] Failed to save env file:', error);
    res.status(500).json({ error: 'Failed to save env file' });
  }
});

// ── Git sources ────────────────────────────────────────────────────────
// Map GitSourceError codes to HTTP statuses so the UI can tell apart things
// a user can fix (bad token, missing file) from transient failures.
function gitSourceStatus(code: GitSourceErrorCode): number {
  switch (code) {
    case 'AUTH_FAILED': return 401;
    case 'REPO_NOT_FOUND':
    case 'BRANCH_NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return 404;
    case 'NETWORK_TIMEOUT': return 504;
    default: return 400;
  }
}

function sendGitSourceError(res: Response, err: unknown): void {
  if (err instanceof GitSourceError) {
    res.status(gitSourceStatus(err.code)).json({ error: err.message, code: err.code });
    return;
  }
  console.error('[GitSource] Unexpected error:', err);
  res.status(500).json({ error: 'Git source operation failed' });
}

app.get('/api/git-sources', async (req: Request, res: Response) => {
  try {
    const all = GitSourceService.getInstance().list();
    // Filter to the subset of stacks the caller can read. Keeps scoped
    // Admiral roles from discovering git config for stacks outside their grant.
    const visible = all.filter(src => checkPermission(req, 'stack:read', 'stack', src.stack_name));
    res.json(visible);
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.get('/api/stacks/:stackName/git-source', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  if (!requirePermission(req, res, 'stack:read', 'stack', stackName)) return;
  try {
    const source = GitSourceService.getInstance().get(stackName);
    if (!source) return res.status(404).json({ error: 'No Git source configured for this stack' });
    res.json(source);
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.put('/api/stacks/:stackName/git-source', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  try {
    const {
      repo_url,
      branch,
      compose_path,
      sync_env,
      env_path,
      auth_type,
      token,
      auto_apply_on_webhook,
      auto_deploy_on_apply,
    } = req.body ?? {};

    if (typeof repo_url !== 'string' || !repo_url.trim()) {
      return res.status(400).json({ error: 'repo_url is required' });
    }
    if (typeof branch !== 'string' || !branch.trim()) {
      return res.status(400).json({ error: 'branch is required' });
    }
    if (typeof compose_path !== 'string' || !compose_path.trim()) {
      return res.status(400).json({ error: 'compose_path is required' });
    }
    if (auth_type !== 'none' && auth_type !== 'token') {
      return res.status(400).json({ error: 'auth_type must be "none" or "token"' });
    }
    if (!/^https:\/\//i.test(repo_url)) {
      return res.status(400).json({ error: 'Only HTTPS repository URLs are supported' });
    }
    // Bound each field so a caller cannot flood the service with huge
    // payloads. These limits are generous compared to anything a real Git
    // provider would produce.
    if (repo_url.length > 2048) {
      return res.status(400).json({ error: 'repo_url is too long' });
    }
    if (branch.length > 256) {
      return res.status(400).json({ error: 'branch is too long' });
    }
    if (compose_path.length > 1024) {
      return res.status(400).json({ error: 'compose_path is too long' });
    }
    if (typeof env_path === 'string' && env_path.length > 1024) {
      return res.status(400).json({ error: 'env_path is too long' });
    }
    if (typeof token === 'string' && token.length > 8192) {
      return res.status(400).json({ error: 'token is too long' });
    }

    // Confirm the stack actually exists on the active node. Without this
    // guard, a caller can stash a git-source row for a name that does not
    // exist yet and have it auto-link when a stack with that name is
    // later created.
    const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    if (!stacks.includes(stackName)) {
      return res.status(404).json({ error: 'Stack not found' });
    }

    const syncEnv = Boolean(sync_env);
    const resolvedEnvPath = syncEnv
      ? (typeof env_path === 'string' && env_path.trim()
        ? env_path
        : path.posix.join(path.posix.dirname(compose_path.replace(/\\/g, '/')) || '.', '.env'))
      : null;

    const source = await GitSourceService.getInstance().upsert({
      stackName,
      repoUrl: repo_url.trim(),
      branch: branch.trim(),
      composePath: compose_path.trim(),
      syncEnv,
      envPath: resolvedEnvPath,
      authType: auth_type,
      token: typeof token === 'string' ? token : undefined,
      autoApplyOnWebhook: Boolean(auto_apply_on_webhook),
      autoDeployOnApply: Boolean(auto_deploy_on_apply),
    });

    console.log(`[GitSource] Configured git source for ${stackName}`);
    res.json(source);
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.delete('/api/stacks/:stackName/git-source', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  try {
    GitSourceService.getInstance().delete(stackName);
    console.log(`[GitSource] Removed git source for ${stackName}`);
    res.json({ success: true });
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.post('/api/stacks/:stackName/git-source/pull', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  try {
    const result = await GitSourceService.getInstance().pull(stackName);
    res.json(result);
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.post('/api/stacks/:stackName/git-source/apply', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  try {
    const { commitSha, deploy } = req.body ?? {};
    if (typeof commitSha !== 'string' || !commitSha.trim()) {
      return res.status(400).json({ error: 'commitSha is required' });
    }
    const result = await GitSourceService.getInstance().apply(
      stackName,
      commitSha.trim(),
      { deploy: typeof deploy === 'boolean' ? deploy : undefined }
    );
    invalidateNodeCaches(req.nodeId);
    const shortSha = commitSha.trim().slice(0, 7);
    if (result.deployed) {
      console.log(`[GitSource] Applied commit ${shortSha} to ${stackName} (deployed)`);
    } else if (result.deployError) {
      console.warn(`[GitSource] Applied commit ${shortSha} to ${stackName}, deploy failed: ${result.deployError}`);
    } else {
      console.log(`[GitSource] Applied commit ${shortSha} to ${stackName}`);
    }
    res.json(result);
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.post('/api/stacks/:stackName/git-source/dismiss-pending', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  if (!requirePermission(req, res, 'stack:edit', 'stack', stackName)) return;
  try {
    GitSourceService.getInstance().dismissPending(stackName);
    res.json({ success: true });
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.post('/api/stacks', async (req: Request, res: Response) => {
  if (!requirePermission(req, res, 'stack:create')) return;
  try {
    const { stackName } = req.body;
    if (!stackName || typeof stackName !== 'string') {
      return res.status(400).json({ error: 'Stack name is required and must be a string' });
    }
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Stack name can only contain alphanumeric characters, hyphens, and underscores' });
    }
    await FileSystemService.getInstance(req.nodeId).createStack(stackName);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Stack created: ${stackName}`);
    res.json({ message: 'Stack created successfully', name: stackName });
  } catch (error: unknown) {
    const message = getErrorMessage(error, '');
    if (message.includes('already exists')) {
      return res.status(409).json({ error: 'Stack already exists' });
    }
    console.error('Failed to create stack:', error);
    res.status(500).json({ error: 'Failed to create stack' });
  }
});

app.post('/api/stacks/from-git', async (req: Request, res: Response) => {
  if (!requirePermission(req, res, 'stack:create')) return;
  try {
    const {
      stack_name,
      repo_url,
      branch,
      compose_path,
      sync_env,
      env_path,
      auth_type,
      token,
      auto_apply_on_webhook,
      auto_deploy_on_apply,
      deploy_now,
    } = req.body ?? {};

    if (typeof stack_name !== 'string' || !stack_name.trim()) {
      return res.status(400).json({ error: 'stack_name is required' });
    }
    if (!isValidStackName(stack_name)) {
      return res.status(400).json({ error: 'Stack name can only contain alphanumeric characters, hyphens, and underscores' });
    }
    if (typeof repo_url !== 'string' || !repo_url.trim()) {
      return res.status(400).json({ error: 'repo_url is required' });
    }
    if (typeof branch !== 'string' || !branch.trim()) {
      return res.status(400).json({ error: 'branch is required' });
    }
    if (typeof compose_path !== 'string' || !compose_path.trim()) {
      return res.status(400).json({ error: 'compose_path is required' });
    }
    const resolvedAuthType = auth_type === 'token' ? 'token' : 'none';
    if (!/^https:\/\//i.test(repo_url)) {
      return res.status(400).json({ error: 'Only HTTPS repository URLs are supported' });
    }
    if (repo_url.length > 2048) {
      return res.status(400).json({ error: 'repo_url is too long' });
    }
    if (branch.length > 256) {
      return res.status(400).json({ error: 'branch is too long' });
    }
    if (compose_path.length > 1024) {
      return res.status(400).json({ error: 'compose_path is too long' });
    }
    if (typeof env_path === 'string' && env_path.length > 1024) {
      return res.status(400).json({ error: 'env_path is too long' });
    }
    if (typeof token === 'string' && token.length > 8192) {
      return res.status(400).json({ error: 'token is too long' });
    }

    // Reject if a stack with this name already exists on disk. Without this
    // the service would catch it at createStack() time, but erroring early
    // avoids spinning up a temp clone we will not use.
    const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    if (stacks.includes(stack_name)) {
      return res.status(409).json({ error: 'Stack already exists' });
    }

    const syncEnv = Boolean(sync_env);
    const resolvedEnvPath = syncEnv
      ? (typeof env_path === 'string' && env_path.trim()
        ? env_path
        : path.posix.join(path.posix.dirname(compose_path.replace(/\\/g, '/')) || '.', '.env'))
      : null;

    const result = await GitSourceService.getInstance().createStackFromGit({
      stackName: stack_name.trim(),
      repoUrl: repo_url.trim(),
      branch: branch.trim(),
      composePath: compose_path.trim(),
      syncEnv,
      envPath: resolvedEnvPath,
      authType: resolvedAuthType,
      token: resolvedAuthType === 'token' && typeof token === 'string' && token !== '' ? token : null,
      autoApplyOnWebhook: Boolean(auto_apply_on_webhook),
      autoDeployOnApply: Boolean(auto_deploy_on_apply),
    });

    invalidateNodeCaches(req.nodeId);

    // Deploy is best-effort. The compose file is already on disk and the
    // git source is linked, so a deploy failure does not roll back the
    // stack; the user can retry the deploy from the editor. This mirrors
    // the apply-then-deploy behavior in GitSourceService.apply().
    let deployed = false;
    let deployError: string | undefined;
    if (deploy_now === true) {
      try {
        await ComposeService.getInstance(req.nodeId).deployStack(stack_name);
        deployed = true;
        invalidateNodeCaches(req.nodeId);
      } catch (e) {
        deployError = getErrorMessage(e, 'Deploy failed');
        console.error(`[Stacks] Deploy after create-from-git failed for ${stack_name}:`, deployError);
      }
    }

    console.log(`[Stacks] Stack created from Git: ${stack_name} at ${result.commitSha.slice(0, 7)}`);
    res.json({
      name: stack_name,
      source: result.source,
      commitSha: result.commitSha,
      envWritten: result.envWritten,
      deployed,
      deployError,
    });
  } catch (error) {
    sendGitSourceError(res, error);
  }
});

app.delete('/api/stacks/:stackName', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:delete', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    // Stage 1: Tell Docker to clean up ghost networks/containers
    try {
      await ComposeService.getInstance(req.nodeId).downStack(stackName);
    } catch (downErr) {
      console.warn(`[Teardown] Docker down failed or nothing to clean up for ${stackName}`);
    }

    // Stage 2: Obliterate the files. Capture failure so Stage 3 still runs.
    let fsErr: unknown = null;
    try {
      await FileSystemService.getInstance(req.nodeId).deleteStack(stackName);
    } catch (err) {
      fsErr = err;
      console.error(`[Stacks] File deletion failed for ${stackName}, continuing with DB cleanup:`, err);
    }

    // Stage 3: DB cleanup. Runs unconditionally because an orphan git_source
    // row would silently auto-link to a future stack with the same name, and
    // stale scoped role assignments / update badges confuse the dashboard.
    DatabaseService.getInstance().clearStackUpdateStatus(req.nodeId, stackName);
    DatabaseService.getInstance().deleteRoleAssignmentsByResource('stack', stackName);
    DatabaseService.getInstance().deleteGitSource(stackName);

    if (fsErr) throw fsErr;

    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Stack deleted: ${stackName}`);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error(`[Stacks] Failed to delete stack ${stackName}:`, error);
    const message = getErrorMessage(error, 'Failed to delete stack');
    res.status(500).json({ error: message });
  }
});

app.get('/api/stacks/:stackName/containers', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);
    res.json(containers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch containers' });
  }
});

app.get('/api/stacks/:stackName/services', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const content = await FileSystemService.getInstance(req.nodeId).getStackContent(stackName);
    const parsed = YAML.parse(content);
    const services = parsed?.services ? Object.keys(parsed.services) : [];
    res.json(services);
  } catch (error) {
    console.error('[Stacks] Failed to fetch services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

app.get('/api/containers/:id/logs', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    // Pass both req and res so we can listen for the client disconnect
    await dockerController.streamContainerLogs(id, req, res);
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize log stream' });
  }
});

app.post('/api/containers/:id/start', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.startContainer(id);
    invalidateNodeCaches(req.nodeId);
    res.json({ message: 'Container started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start container' });
  }
});

app.post('/api/containers/:id/stop', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.stopContainer(id);
    invalidateNodeCaches(req.nodeId);
    res.json({ message: 'Container stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop container' });
  }
});

app.post('/api/containers/:id/restart', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.restartContainer(id);
    invalidateNodeCaches(req.nodeId);
    res.json({ message: 'Container restarted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart container' });
  }
});

// End of legacy container routes
app.post('/api/stacks/:stackName/deploy', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const debug = isDebugEnabled();
    const atomic = LicenseService.getInstance().getTier() === 'paid';
    if (debug) console.debug('[Stacks:debug] Deploy starting', { stackName, atomic, nodeId: req.nodeId });
    const t0 = Date.now();
    await ComposeService.getInstance(req.nodeId).deployStack(stackName, terminalWs || undefined, atomic);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Deploy completed: ${stackName}`);
    if (debug) console.debug(`[Stacks:debug] Deploy finished in ${Date.now() - t0}ms`);
    res.json({ message: 'Deployed successfully' });
  } catch (error: unknown) {
    console.error(`[Stacks] Deploy failed: ${stackName}`, error);
    const rolledBack = LicenseService.getInstance().getTier() === 'paid';
    if (rolledBack) console.warn(`[Stacks] Deploy failed, rolled back: ${stackName}`);
    const message = getErrorMessage(error, 'Failed to deploy stack');
    res.status(500).json({ error: message, rolledBack });
  }
});

app.post('/api/stacks/:stackName/down', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    await ComposeService.getInstance(req.nodeId).runCommand(stackName, 'down', terminalWs || undefined);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Down completed: ${stackName}`);
    res.json({ status: 'Command started' });
  } catch (error) {
    console.error(`[Stacks] Down failed: ${stackName}`, error);
    res.status(500).json({ error: 'Failed to start command' });
  }
});

app.post('/api/stacks/:stackName/restart', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.restartContainer(c.Id)));
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Restart completed: ${stackName} (${containers.length} containers)`);
    res.json({ success: true, message: 'Restart completed via Engine API.' });
  } catch (error: unknown) {
    console.error(`[Stacks] Restart failed: ${stackName}`, error);
    const message = getErrorMessage(error, 'Failed to restart containers');
    res.status(500).json({ error: message });
  }
});

app.post('/api/stacks/:stackName/stop', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.stopContainer(c.Id)));
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Stop completed: ${stackName} (${containers.length} containers)`);
    res.json({ success: true, message: 'Stop completed via Engine API.' });
  } catch (error: unknown) {
    console.error(`[Stacks] Stop failed: ${stackName}`, error);
    const message = getErrorMessage(error, 'Failed to stop containers');
    res.status(500).json({ error: message });
  }
});

app.post('/api/stacks/:stackName/start', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.startContainer(c.Id)));
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Start completed: ${stackName} (${containers.length} containers)`);
    res.json({ success: true, message: 'Start completed via Engine API.' });
  } catch (error: unknown) {
    console.error(`[Stacks] Start failed: ${stackName}`, error);
    const message = getErrorMessage(error, 'Failed to start containers');
    res.status(500).json({ error: message });
  }
});

// Update stack: pull images and recreate containers
app.post('/api/stacks/:stackName/update', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const debug = isDebugEnabled();
    const atomic = LicenseService.getInstance().getTier() === 'paid';
    if (debug) console.debug('[Stacks:debug] Update starting', { stackName, atomic, nodeId: req.nodeId });
    const t0 = Date.now();
    await ComposeService.getInstance(req.nodeId).updateStack(stackName, terminalWs || undefined, atomic);
    DatabaseService.getInstance().clearStackUpdateStatus(req.nodeId, stackName);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Update completed: ${stackName}`);
    if (debug) console.debug(`[Stacks:debug] Update finished in ${Date.now() - t0}ms`);
    res.json({ status: 'Update completed' });
  } catch (error) {
    console.error(`[Stacks] Update failed: ${stackName}`, error);
    const rolledBack = LicenseService.getInstance().getTier() === 'paid';
    if (rolledBack) console.warn(`[Stacks] Update failed, rolled back: ${stackName}`);
    res.status(500).json({ error: 'Failed to update', rolledBack });
  }
});

// Manual rollback endpoint (Skipper+ and Admin)
app.post('/api/stacks/:stackName/rollback', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!requirePaid(req, res)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const fsSvc = FileSystemService.getInstance(req.nodeId);
    const backupInfo = await fsSvc.getBackupInfo(stackName);
    if (!backupInfo.exists) {
      return res.status(404).json({ error: 'No backup available for this stack.' });
    }
    console.log(`[Stacks] Rollback initiated: ${stackName}`);
    await fsSvc.restoreStackFiles(stackName);
    // Re-deploy with restored files (non-atomic to avoid loops)
    await ComposeService.getInstance(req.nodeId).deployStack(stackName, terminalWs || undefined, false);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Rollback completed: ${stackName}`);
    res.json({ message: 'Stack rolled back successfully.' });
  } catch (error: unknown) {
    console.error(`[Stacks] Rollback failed: ${stackName}`, error);
    const message = getErrorMessage(error, 'Rollback failed.');
    res.status(500).json({ error: message });
  }
});

// Backup info endpoint (read-only)
app.get('/api/stacks/:stackName/backup', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const fsSvc = FileSystemService.getInstance(req.nodeId);
    const info = await fsSvc.getBackupInfo(stackName);
    res.json(info);
  } catch (error: unknown) {
    console.error('Failed to get backup info:', error);
    const message = getErrorMessage(error, 'Failed to get backup info.');
    res.status(500).json({ error: message });
  }
});

// Docker Run to Compose converter endpoint
app.post('/api/convert', async (req: Request, res: Response) => {
  try {
    const { dockerRun } = req.body;
    if (!dockerRun || typeof dockerRun !== 'string') {
      return res.status(400).json({ error: 'dockerRun command is required' });
    }
    const yaml = composerize(dockerRun);
    res.json({ yaml });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Failed to convert docker run command' });
  }
});

// Get all containers stats for dashboard.
// Cached per-node for 2s to collapse multi-tab polling pressure. Invalidated
// by stack/container write endpoints (deploy, down, start, stop, restart, etc).
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const composeDir = path.resolve(NodeRegistry.getInstance().getComposeDir(req.nodeId));
    const result = await CacheService.getInstance().getOrFetch(
      `stats:${req.nodeId}`,
      STATS_CACHE_TTL_MS,
      async () => {
        const allContainers = await DockerController.getInstance(req.nodeId).getAllContainers();

        // A container is "managed" if Docker started it from within COMPOSE_DIR.
        // We use com.docker.compose.project.working_dir rather than project name because
        // stacks launched from the COMPOSE_DIR root (not a subdirectory) all share the
        // project name of the root folder, causing false "external" classification.
        const isManagedByComposeDir = (c: any): boolean => {
          const workingDir: string | undefined = c.Labels?.['com.docker.compose.project.working_dir'];
          if (!workingDir) return false;
          const resolved = path.resolve(workingDir);
          return resolved === composeDir || resolved.startsWith(composeDir + path.sep);
        };

        const active = allContainers.filter((c: any) => c.State === 'running').length;
        const exited = allContainers.filter((c: any) => c.State === 'exited').length;
        const total = allContainers.length;
        const managed = allContainers.filter((c: any) => c.State === 'running' && isManagedByComposeDir(c)).length;
        const unmanaged = allContainers.filter((c: any) => c.State === 'running' && !isManagedByComposeDir(c)).length;

        return { active, managed, unmanaged, exited, total };
      },
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/metrics/historical', async (req: Request, res: Response) => {
  try {
    const metrics = DatabaseService.getInstance().getContainerMetrics(24);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

app.get('/api/logs/global', async (req: Request, res: Response) => {
  try {
    const debug = isDebugEnabled();
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getRunningContainers();
    const allLogs: GlobalLogEntry[] = [];
    if (debug) console.debug('[GlobalLogs:debug] Polling snapshot starting', { containerCount: containers.length, nodeId: req.nodeId });

    await Promise.all(containers.map(async (c) => {
      const stackName = c.Labels?.['com.docker.compose.project'] || 'system';
      const rawName = c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12);
      const containerName = normalizeContainerName(rawName, stackName);

      try {
        const container = dockerController.getDocker().getContainer(c.Id);
        const inspect = await container.inspect();
        const isTty = inspect.Config.Tty;
        const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 100, timestamps: true }) as Buffer;

        demuxDockerLog(logsBuffer, isTty, (line, source) => {
          if (!line.trim()) return;
          const { timestampMs, cleanMessage } = parseLogTimestamp(line);
          const level = detectLogLevel(cleanMessage, source);
          allLogs.push({ stackName, containerName, source, level, message: cleanMessage, timestampMs });
        });
      } catch (err) {
        console.warn(`[GlobalLogs] Failed to fetch/parse logs for container ${containerName} (${c.Id.substring(0, 12)}):`, (err as Error).message);
      }
    }));

    // Sort globally by timestamp ascending (newest bottom).
    // Limit to 500 lines; the client renders at most 300 rows at once.
    allLogs.sort((a, b) => a.timestampMs - b.timestampMs);
    if (debug) console.debug('[GlobalLogs:debug] Polling snapshot complete', { totalLines: allLogs.length });
    res.json(allLogs.slice(-500));
  } catch (error) {
    console.error('[GlobalLogs] Snapshot fetch failed:', (error as Error).message);
    res.status(500).json({ error: 'Failed to fetch global logs' });
  }
});

app.get('/api/logs/global/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Prevent nginx from buffering SSE events (would cause burst delivery).
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const debug = isDebugEnabled();
  const dockerController = DockerController.getInstance(req.nodeId);
  const streams: NodeJS.ReadableStream[] = [];

  // Send a heartbeat comment every 30s to keep reverse proxies from closing
  // idle connections. SSE comments (lines starting with ':') are silently
  // discarded by the browser's EventSource API.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(':heartbeat\n\n');
  }, 30_000);

  try {
    const containers = await dockerController.getRunningContainers();
    if (debug) console.debug('[GlobalLogs:debug] SSE stream opened', { containerCount: containers.length, nodeId: req.nodeId });

    await Promise.all(containers.map(async (c) => {
      const stackName = c.Labels?.['com.docker.compose.project'] || 'system';
      const rawName = c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12);
      const containerName = normalizeContainerName(rawName, stackName);

      try {
        const container = dockerController.getDocker().getContainer(c.Id);
        const inspect = await container.inspect();
        const isTty = inspect.Config.Tty;

        const stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 500, timestamps: true });
        streams.push(stream);

        stream.on('data', (chunk: Buffer) => {
          demuxDockerLog(chunk, isTty, (line, source) => {
            if (!line.trim()) return;
            const { timestampMs, cleanMessage } = parseLogTimestamp(line);
            const level = detectLogLevel(cleanMessage, source);
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ stackName, containerName, source, level, message: cleanMessage, timestampMs })}\n\n`);
            }
          });
        });
      } catch (err) {
        console.warn(`[GlobalLogs] Failed to attach stream for container ${containerName} (${c.Id.substring(0, 12)}):`, (err as Error).message);
      }
    }));

    req.on('close', () => {
      clearInterval(heartbeat);
      if (debug) console.debug('[GlobalLogs:debug] SSE stream closed, cleaning up', { streamCount: streams.length });
      streams.forEach(s => {
        try { (s as NodeJS.ReadableStream & { destroy(): void }).destroy(); } catch { /* stream already ended */ }
      });
    });

  } catch (error) {
    clearInterval(heartbeat);
    console.error('[GlobalLogs] SSE stream attachment failed:', (error as Error).message);
    res.write(`data: ${JSON.stringify({ level: 'ERROR', message: '[Sencho] Failed to attach global log stream.', timestampMs: Date.now(), stackName: 'system', containerName: 'backend', source: 'STDERR' })}\n\n`);
    res.end();
  }
});

// Get host system stats.
// Cached for 3s to collapse overlapping samplers: the dashboard polls every 5s,
// MonitorService samples every 30s, and si.currentLoad() blocks for ~200ms per
// call. A short TTL makes concurrent polls share one sample without noticeable
// UX staleness. No write-path invalidation: these are pure host metrics.
app.get('/api/system/stats', async (req: Request, res: Response) => {
  try {
    // Network is read outside the cache because it is cheap and per-request.
    const rxSec = Math.max(0, globalDockerNetwork.rxSec);
    const txSec = Math.max(0, globalDockerNetwork.txSec);

    const sample = await CacheService.getInstance().getOrFetch(
      `system-stats:${req.nodeId}`,
      SYSTEM_STATS_CACHE_TTL_MS,
      async () => {
        // Remote node requests are intercepted and proxied by remoteNodeProxy
        // before reaching here. This fetcher only runs for local nodes.
        const [currentLoad, mem, fsSize] = await Promise.all([
          si.currentLoad(),
          si.mem(),
          si.fsSize(),
        ]);

        const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:') || fsSize[0];

        return {
          cpu: {
            usage: currentLoad.currentLoad.toFixed(1),
            cores: currentLoad.cpus.length,
          },
          memory: {
            total: mem.total,
            used: mem.used,
            free: mem.free,
            usagePercent: ((mem.used / mem.total) * 100).toFixed(1),
          },
          disk: mainDisk ? {
            fs: mainDisk.fs,
            mount: mainDisk.mount,
            total: mainDisk.size,
            used: mainDisk.used,
            free: mainDisk.available,
            usagePercent: mainDisk.use ? mainDisk.use.toFixed(1) : '0',
          } : null,
        };
      },
    );

    res.json({ ...sample, network: { rxBytes: 0, txBytes: 0, rxSec, txSec } });
  } catch (error) {
    console.error('Failed to fetch system stats:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// Admin-only cache observability: per-namespace hit/miss/stale counters and
// live entry counts for the unified CacheService. Used by Settings → About and
// for post-deployment verification that cache hit rates look healthy.
app.get('/api/system/cache-stats', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(CacheService.getInstance().getStats());
  } catch (error) {
    console.error('Failed to fetch cache stats:', error);
    res.status(500).json({ error: 'Failed to fetch cache stats' });
  }
});

// --- Notification & Alerting Routes ---

const NOTIFICATION_CHANNEL_TYPES = ['discord', 'slack', 'webhook'] as const;

/** Trim, deduplicate, and drop empty entries from a stack_patterns array. */
const cleanStackPatterns = (patterns: string[]): string[] =>
  [...new Set(patterns.map(p => p.trim()).filter(Boolean))];

/** Validate that a string is a well-formed HTTPS URL. Returns an error string or null. */
function validateHttpsUrl(value: unknown): string | null {
  if (!value || typeof value !== 'string' || !value.startsWith('https://')) return 'must be a valid HTTPS URL';
  try { new URL(value); } catch { return 'is not a valid URL'; }
  return null;
}

app.get('/api/agents', authMiddleware, async (req: Request, res: Response) => {
  try {
    const agents = DatabaseService.getInstance().getAgents();
    res.json(agents);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

app.post('/api/agents', authMiddleware, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { type, url, enabled } = req.body;
    if (!type || !NOTIFICATION_CHANNEL_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be ${NOTIFICATION_CHANNEL_TYPES.join(', ')}` });
      return;
    }
    const urlErr = validateHttpsUrl(url);
    if (urlErr) { res.status(400).json({ error: `url ${urlErr}` }); return; }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    DatabaseService.getInstance().upsertAgent({ type, url, enabled });
    console.log(`[Agents] Agent ${type} updated`);
    if (isDebugEnabled()) console.log(`[Agents:diag] Agent ${type} upsert: enabled=${enabled}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Keys that contain auth credentials - never exposed to the frontend or writable via settings API
const PRIVATE_SETTINGS_KEYS = new Set(['auth_username', 'auth_password_hash', 'auth_jwt_secret']);

// Strict allowlist of keys writable via the settings API (prevents overwriting auth credentials)
const ALLOWED_SETTING_KEYS = new Set([
  'host_cpu_limit',
  'host_ram_limit',
  'host_disk_limit',
  'docker_janitor_gb',
  'global_crash',
  'global_logs_refresh',
  'developer_mode',
  'template_registry_url',
  'metrics_retention_hours',
  'log_retention_days',
  'audit_retention_days',
]);

// Zod schema for bulk PATCH - all keys optional, present keys fully validated
import { z } from 'zod';
const SettingsPatchSchema = z.object({
  host_cpu_limit: z.coerce.number().int().min(1).max(100).transform(String),
  host_ram_limit: z.coerce.number().int().min(1).max(100).transform(String),
  host_disk_limit: z.coerce.number().int().min(1).max(100).transform(String),
  docker_janitor_gb: z.coerce.number().min(0).transform(String),
  global_crash: z.enum(['0', '1']),
  global_logs_refresh: z.enum(['1', '3', '5', '10']),
  developer_mode: z.enum(['0', '1']),
  template_registry_url: z.string().max(2048).refine(v => v === '' || /^https?:\/\/.+/.test(v), { message: 'Must be a valid URL or empty' }),
  metrics_retention_hours: z.coerce.number().int().min(1).max(8760).transform(String),
  log_retention_days: z.coerce.number().int().min(1).max(365).transform(String),
  audit_retention_days: z.coerce.number().int().min(1).max(365).transform(String),
}).partial();

app.get('/api/settings', async (req: Request, res: Response) => {
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    // Strip auth credentials - these are managed exclusively by /api/auth/* endpoints
    for (const key of PRIVATE_SETTINGS_KEYS) {
      delete settings[key];
    }
    res.json(settings);
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string' || !ALLOWED_SETTING_KEYS.has(key)) {
      res.status(400).json({ error: `Invalid or disallowed setting key: ${key}` });
      return;
    }
    if (value === undefined || value === null) {
      res.status(400).json({ error: 'Setting value is required' });
      return;
    }
    DatabaseService.getInstance().updateGlobalSetting(key, String(value));
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

app.patch('/api/settings', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const parsed = SettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const db = DatabaseService.getInstance();
    const updateMany = db.getDb().transaction((entries: [string, string][]) => {
      for (const [k, v] of entries) {
        db.updateGlobalSetting(k, v);
      }
    });
    updateMany(Object.entries(parsed.data) as [string, string][]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to bulk update settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.get('/api/alerts', authMiddleware, async (req: Request, res: Response) => {
  try {
    let stackName = req.query.stackName as string | undefined;
    if (Array.isArray(stackName)) stackName = stackName[0] as string;

    const alerts = DatabaseService.getInstance().getStackAlerts(stackName);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

const AlertCreateSchema = z.object({
  stack_name: z.string().min(1).max(255),
  metric: z.enum(['cpu_percent', 'memory_percent', 'memory_mb', 'net_rx', 'net_tx', 'restart_count']),
  operator: z.enum(['>', '>=', '<', '<=', '==']),
  threshold: z.number().min(0),
  duration_mins: z.coerce.number().int().min(0).max(1440),
  cooldown_mins: z.coerce.number().int().min(0).max(10080),
});

app.post('/api/alerts', authMiddleware, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const parsed = AlertCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid alert data', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const created = DatabaseService.getInstance().addStackAlert(parsed.data);
    res.status(201).json(created);
  } catch (error) {
    console.error('Failed to add alert:', error);
    res.status(500).json({ error: 'Failed to add alert' });
  }
});

app.delete('/api/alerts/:id', authMiddleware, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    DatabaseService.getInstance().deleteStackAlert(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

app.get('/api/notifications', authMiddleware, async (req: Request, res: Response) => {
  try {
    const history = DatabaseService.getInstance().getNotificationHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/read', authMiddleware, async (req: Request, res: Response) => {
  try {
    DatabaseService.getInstance().markAllNotificationsRead();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

app.delete('/api/notifications/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid notification ID' }); return; }
    DatabaseService.getInstance().deleteNotification(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.delete('/api/notifications', authMiddleware, async (req: Request, res: Response) => {
  try {
    DatabaseService.getInstance().deleteAllNotifications();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

app.post('/api/notifications/test', authMiddleware, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { type, url } = req.body;
    if (!type || !NOTIFICATION_CHANNEL_TYPES.includes(type)) {
      res.status(400).json({ error: `type must be ${NOTIFICATION_CHANNEL_TYPES.join(', ')}` });
      return;
    }
    const urlErr = validateHttpsUrl(url);
    if (urlErr) { res.status(400).json({ error: `url ${urlErr}` }); return; }
    await NotificationService.getInstance().testDispatch(type, url);
    res.json({ success: true });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Test failed', details: getErrorMessage(error, String(error)) });
  }
});

// --- Notification Routes (Admiral) ---

app.get('/api/notification-routes', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const routes = DatabaseService.getInstance().getNotificationRoutes();
    res.json(routes);
  } catch (error) {
    console.error('Failed to fetch notification routes:', error);
    res.status(500).json({ error: 'Failed to fetch notification routes' });
  }
});

app.post('/api/notification-routes', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const { name, stack_patterns, channel_type, channel_url, priority, enabled } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }
    if (name.trim().length > 100) {
      res.status(400).json({ error: 'Name must be 100 characters or fewer' });
      return;
    }
    if (!Array.isArray(stack_patterns) || stack_patterns.length === 0 || stack_patterns.some((p: unknown) => typeof p !== 'string')) {
      res.status(400).json({ error: 'stack_patterns must be a non-empty array of stack names' });
      return;
    }
    const cleanedPatterns = cleanStackPatterns(stack_patterns);
    if (cleanedPatterns.length === 0) {
      res.status(400).json({ error: 'stack_patterns must contain at least one non-empty stack name' });
      return;
    }
    if (!NOTIFICATION_CHANNEL_TYPES.includes(channel_type)) {
      res.status(400).json({ error: `channel_type must be ${NOTIFICATION_CHANNEL_TYPES.join(', ')}` });
      return;
    }
    const channelUrlErr = validateHttpsUrl(channel_url);
    if (channelUrlErr) { res.status(400).json({ error: `channel_url ${channelUrlErr}` }); return; }
    if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority))) {
      res.status(400).json({ error: 'priority must be a finite number' });
      return;
    }

    const now = Date.now();
    const route = DatabaseService.getInstance().createNotificationRoute({
      name: name.trim(),
      stack_patterns: cleanedPatterns,
      channel_type,
      channel_url: channel_url.trim(),
      priority: typeof priority === 'number' ? priority : 0,
      enabled: enabled !== false,
      created_at: now,
      updated_at: now,
    });
    console.log(`[Routes] Route "${route.name}" created (id=${route.id})`);
    if (isDebugEnabled()) console.log(`[Routes:diag] Route "${route.name}" created with patterns=[${cleanedPatterns}], channel=${channel_type}`);
    res.status(201).json(route);
  } catch (error) {
    console.error('Failed to create notification route:', error);
    res.status(500).json({ error: 'Failed to create notification route' });
  }
});

app.put('/api/notification-routes/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid route ID' }); return; }

    const existing = DatabaseService.getInstance().getNotificationRoute(id);
    if (!existing) { res.status(404).json({ error: 'Route not found' }); return; }

    const { name, stack_patterns, channel_type, channel_url, priority, enabled } = req.body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ error: 'Name must be a non-empty string' });
      return;
    }
    if (name !== undefined && name.trim().length > 100) {
      res.status(400).json({ error: 'Name must be 100 characters or fewer' });
      return;
    }
    let cleanedPatterns: string[] | undefined;
    if (stack_patterns !== undefined) {
      if (!Array.isArray(stack_patterns) || stack_patterns.length === 0 || stack_patterns.some((p: unknown) => typeof p !== 'string')) {
        res.status(400).json({ error: 'stack_patterns must be a non-empty array of stack names' });
        return;
      }
      cleanedPatterns = cleanStackPatterns(stack_patterns);
      if (cleanedPatterns.length === 0) {
        res.status(400).json({ error: 'stack_patterns must contain at least one non-empty stack name' });
        return;
      }
    }
    if (channel_type !== undefined && !NOTIFICATION_CHANNEL_TYPES.includes(channel_type)) {
      res.status(400).json({ error: `channel_type must be ${NOTIFICATION_CHANNEL_TYPES.join(', ')}` });
      return;
    }
    if (channel_url !== undefined) {
      const urlErr = validateHttpsUrl(channel_url);
      if (urlErr) { res.status(400).json({ error: `channel_url ${urlErr}` }); return; }
    }
    if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority))) {
      res.status(400).json({ error: 'priority must be a finite number' });
      return;
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    const updates: Record<string, unknown> = { updated_at: Date.now() };
    if (name !== undefined) updates.name = name.trim();
    if (cleanedPatterns !== undefined) updates.stack_patterns = cleanedPatterns;
    if (channel_type !== undefined) updates.channel_type = channel_type;
    if (channel_url !== undefined) updates.channel_url = channel_url.trim();
    if (priority !== undefined) updates.priority = priority;
    if (enabled !== undefined) updates.enabled = enabled;

    DatabaseService.getInstance().updateNotificationRoute(id, updates);
    const updated = DatabaseService.getInstance().getNotificationRoute(id);
    console.log(`[Routes] Route ${id} updated`);
    if (isDebugEnabled()) console.log(`[Routes:diag] Route ${id} update fields: ${Object.keys(updates).filter(k => k !== 'updated_at')}`);
    res.json(updated);
  } catch (error) {
    console.error('Failed to update notification route:', error);
    res.status(500).json({ error: 'Failed to update notification route' });
  }
});

app.delete('/api/notification-routes/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid route ID' }); return; }

    const changes = DatabaseService.getInstance().deleteNotificationRoute(id);
    if (changes === 0) { res.status(404).json({ error: 'Route not found' }); return; }
    console.log(`[Routes] Route ${id} deleted`);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete notification route:', error);
    res.status(500).json({ error: 'Failed to delete notification route' });
  }
});

app.post('/api/notification-routes/:id/test', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid route ID' }); return; }

    const route = DatabaseService.getInstance().getNotificationRoute(id);
    if (!route) { res.status(404).json({ error: 'Route not found' }); return; }

    if (isDebugEnabled()) console.log(`[Routes:diag] Test dispatch for route ${id} (${route.channel_type} -> ${route.channel_url})`);
    await NotificationService.getInstance().testDispatch(route.channel_type, route.channel_url);
    res.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Test failed', details: msg });
  }
});

// Issue a short-lived console session token for WebSocket proxy delegation.
// When the gateway needs to proxy an interactive terminal (host console or container exec)
// to a remote node, it calls this endpoint (authenticated with the long-lived api_token)
// to receive a short-lived token. The remote's WS upgrade handler allows 'console_session'
// tokens through its isProxyToken guard, keeping the long-lived api_token off interactive paths.
app.post('/api/system/console-token', authMiddleware, (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot generate console tokens.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) {
      res.status(500).json({ error: 'No JWT secret configured' });
      return;
    }
    const consoleToken = jwt.sign({ scope: 'console_session' }, jwtSecret, { expiresIn: '60s' });
    res.json({ token: consoleToken });
  } catch (error) {
    console.error('Failed to issue console token:', error);
    res.status(500).json({ error: 'Failed to issue console token' });
  }
});

// --- SSO Config Routes (admin + Admiral, local-only) ---

app.get('/api/sso/config', (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access SSO configuration.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const configs = DatabaseService.getInstance().getSSOConfigs();
    const result = configs.map(c => {
      const parsed = JSON.parse(c.config_json);
      // Strip encrypted secrets from response
      delete parsed.ldapBindPassword;
      delete parsed.oidcClientSecret;
      return { ...parsed, provider: c.provider, enabled: c.enabled === 1 };
    });
    res.json(result);
  } catch (error) {
    console.error('[SSO] Failed to fetch SSO configs:', error);
    res.status(500).json({ error: 'Failed to fetch SSO configuration' });
  }
});

app.get('/api/sso/config/:provider', (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access SSO configuration.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const config = SSOService.getInstance().getProviderConfig(String(req.params.provider));
    if (!config) {
      res.status(404).json({ error: 'Provider not configured' });
      return;
    }
    // Strip encrypted secrets
    const result = { ...config };
    delete result.ldapBindPassword;
    delete result.oidcClientSecret;
    res.json(result);
  } catch (error) {
    console.error('[SSO] Failed to fetch SSO config:', error);
    res.status(500).json({ error: 'Failed to fetch SSO configuration' });
  }
});

app.put('/api/sso/config/:provider', (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access SSO configuration.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const provider = String(req.params.provider);
    const validProviders = ['ldap', 'oidc_google', 'oidc_github', 'oidc_okta'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: 'Invalid SSO provider' });
      return;
    }
    const config = { ...req.body, provider } as import('./services/SSOService').SSOProviderConfig;

    // Validate required fields when enabling a provider
    if (config.enabled) {
      const missing: string[] = [];
      if (provider === 'ldap') {
        if (!config.ldapUrl?.trim()) missing.push('Server URL');
        if (!config.ldapSearchBase?.trim()) missing.push('Search Base');
      } else {
        if (!config.oidcClientId?.trim()) missing.push('Client ID');
        if (provider === 'oidc_okta' && !config.oidcIssuerUrl?.trim()) missing.push('Issuer URL');
      }
      if (missing.length > 0) {
        res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
        return;
      }
    }

    SSOService.getInstance().saveProviderConfig(config);
    console.log(`[SSO] Config updated: ${provider} ${config.enabled ? 'enabled' : 'disabled'}`);
    res.json({ success: true, message: 'SSO configuration saved' });
  } catch (error) {
    console.error('[SSO] Failed to save SSO config:', error);
    res.status(500).json({ error: 'Failed to save SSO configuration' });
  }
});

app.delete('/api/sso/config/:provider', (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access SSO configuration.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const deletedProvider = String(req.params.provider);
    SSOService.getInstance().deleteProviderConfig(deletedProvider);
    console.log(`[SSO] Config deleted: ${deletedProvider}`);
    res.json({ success: true, message: 'SSO configuration deleted' });
  } catch (error) {
    console.error('[SSO] Failed to delete SSO config:', error);
    res.status(500).json({ error: 'Failed to delete SSO configuration' });
  }
});

app.post('/api/sso/config/:provider/test', async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access SSO configuration.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const provider = String(req.params.provider);
    if (provider === 'ldap') {
      const result = await SSOService.getInstance().testLdapConnection();
      res.json(result);
    } else {
      const result = await SSOService.getInstance().testOidcDiscovery(provider);
      res.json(result);
    }
  } catch (error) {
    console.error('[SSO] Connection test failed:', error);
    res.status(500).json({ success: false, error: 'Connection test failed' });
  }
});

// --- Audit Log Routes (Admiral, local-only) ---

app.get('/api/audit-log', async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmiral(req, res)) return;
  if (!requirePermission(req, res, 'system:audit')) return;

  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const username = req.query.username as string | undefined;
    const method = req.query.method as string | undefined;
    const search = req.query.search as string | undefined;
    const from = req.query.from ? parseInt(req.query.from as string) : undefined;
    const to = req.query.to ? parseInt(req.query.to as string) : undefined;

    if (isDebugEnabled()) {
      console.log(`[Audit:diag] Query: page=${page} limit=${limit} username=${username || '-'} method=${method || '-'} search=${search || '-'}`);
    }
    const result = DatabaseService.getInstance().getAuditLogs({ page, limit, username, method, from, to, search });
    res.json(result);
  } catch (error) {
    console.error('[AuditLog] Failed to fetch audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

app.get('/api/audit-log/export', async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmiral(req, res)) return;
  if (!requirePermission(req, res, 'system:audit')) return;

  try {
    const format = (req.query.format as string) === 'csv' ? 'csv' : 'json';
    const username = req.query.username as string | undefined;
    const method = req.query.method as string | undefined;
    const search = req.query.search as string | undefined;
    const from = req.query.from ? parseInt(req.query.from as string) : undefined;
    const to = req.query.to ? parseInt(req.query.to as string) : undefined;

    if (isDebugEnabled()) {
      console.log(`[Audit:diag] Export: format=${format} filters=${JSON.stringify({ username, method, search, from, to })}`);
    }
    const result = DatabaseService.getInstance().getAuditLogs({ page: 1, limit: 10000, username, method, from, to, search });
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${timestamp}.json"`);
      res.json(result.entries);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${timestamp}.csv"`);

      const csvEscape = (val: string | number | null): string => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const headers = ['id', 'timestamp', 'username', 'method', 'path', 'status_code', 'node_id', 'ip_address', 'summary'];
      const rows = result.entries.map(e =>
        headers.map(h => csvEscape(e[h as keyof typeof e])).join(',')
      );
      res.send([headers.join(','), ...rows].join('\n'));
    }
  } catch (error) {
    console.error('[AuditLog] Export failed:', error);
    res.status(500).json({ error: 'Failed to export audit log' });
  }
});

// --- API Token Routes (Admiral, admin-only, local-only) ---

app.post('/api/api-tokens', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage other API tokens.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const { name, scope, expires_in } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Token name is required.' });
      return;
    }
    if (name.trim().length > 100) {
      res.status(400).json({ error: 'Token name must be 100 characters or fewer.' });
      return;
    }
    const validScopes = ['read-only', 'deploy-only', 'full-admin'];
    if (!scope || !validScopes.includes(scope)) {
      res.status(400).json({ error: `Scope must be one of: ${validScopes.join(', ')}` });
      return;
    }
    const validExpiry = [30, 60, 90, 365];
    if (expires_in !== undefined && expires_in !== null && !validExpiry.includes(expires_in)) {
      res.status(400).json({ error: `expires_in must be one of: ${validExpiry.join(', ')} (days), or null for no expiry.` });
      return;
    }
    const expiresAt = typeof expires_in === 'number' ? Date.now() + expires_in * 24 * 60 * 60 * 1000 : null;

    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) {
      res.status(500).json({ error: 'No JWT secret configured.' });
      return;
    }

    const db = DatabaseService.getInstance();
    const user = db.getUserByUsername(req.user!.username);
    if (!user) {
      res.status(500).json({ error: 'User not found.' });
      return;
    }

    const activeCount = db.getActiveApiTokenCountByUser(user.id);
    if (activeCount >= 25) {
      res.status(400).json({ error: 'Maximum of 25 active API tokens per user.' });
      return;
    }

    if (db.getActiveApiTokenByNameAndUser(name.trim(), user.id)) {
      res.status(409).json({ error: 'An active token with this name already exists.' });
      return;
    }

    // JWT ceiling exceeds the longest user-selectable expiry (365d) so the DB check is always tighter
    const API_TOKEN_JWT_CEILING = '400d';
    const rawToken = jwt.sign({ scope: 'api_token', sub: user.username, jti: crypto.randomUUID() }, jwtSecret, { expiresIn: API_TOKEN_JWT_CEILING });
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const id = db.addApiToken({
      token_hash: tokenHash,
      name: name.trim(),
      scope: scope as 'read-only' | 'deploy-only' | 'full-admin',
      user_id: user.id,
      created_at: Date.now(),
      expires_at: expiresAt,
    });

    if (isDebugEnabled()) console.log('[ApiTokens:diag] Token created:', { name: name.trim(), scope, expires_in, user: req.user!.username });
    res.status(201).json({ id, token: rawToken });
  } catch (error) {
    console.error('[ApiTokens] Create error:', error);
    res.status(500).json({ error: 'Failed to create API token' });
  }
});

app.get('/api/api-tokens', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage other API tokens.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const user = DatabaseService.getInstance().getUserByUsername(req.user!.username);
    if (!user) { res.status(500).json({ error: 'User not found.' }); return; }
    const tokens = DatabaseService.getInstance().getApiTokensByUser(user.id);
    // Never expose token hashes to the client
    const sanitized = tokens.map(({ token_hash: _hash, ...rest }) => rest);
    res.json(sanitized);
  } catch (error) {
    console.error('[ApiTokens] List error:', error);
    res.status(500).json({ error: 'Failed to list API tokens' });
  }
});

app.delete('/api/api-tokens/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage other API tokens.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid token ID.' }); return; }

    const apiToken = DatabaseService.getInstance().getApiTokenById(id);
    if (!apiToken) { res.status(404).json({ error: 'API token not found.' }); return; }

    const user = DatabaseService.getInstance().getUserByUsername(req.user!.username);
    if (!user || apiToken.user_id !== user.id) {
      res.status(403).json({ error: 'You can only revoke your own tokens.' });
      return;
    }

    DatabaseService.getInstance().revokeApiToken(id);
    if (isDebugEnabled()) console.log('[ApiTokens:diag] Token revoked:', { id, name: apiToken.name, user: req.user!.username });
    res.json({ success: true });
  } catch (error) {
    console.error('[ApiTokens] Revoke error:', error);
    res.status(500).json({ error: 'Failed to revoke API token' });
  }
});

// --- Scheduled Operations Routes (Admiral, admin-only, local-only) ---

app.get('/api/scheduled-tasks', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    let tasks = DatabaseService.getInstance().getScheduledTasks();
    // Skipper users only see 'update' tasks; Admiral sees all
    const ls = LicenseService.getInstance();
    if (ls.getVariant() !== 'admiral') {
      tasks = tasks.filter(t => t.action === 'update');
    }
    // Separate Auto-Update and Scheduled Operations into distinct views
    const actionFilter = typeof req.query.action === 'string' ? req.query.action : undefined;
    const excludeAction = typeof req.query.exclude_action === 'string' ? req.query.exclude_action : undefined;
    if (actionFilter) {
      tasks = tasks.filter(t => t.action === actionFilter);
    } else if (excludeAction) {
      tasks = tasks.filter(t => t.action !== excludeAction);
    }
    res.json(tasks);
  } catch (error) {
    console.error('[ScheduledTasks] List error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled tasks' });
  }
});

app.post('/api/scheduled-tasks', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  try {
    const { name, target_type, target_id, node_id, action, cron_expression, enabled, prune_targets, target_services, prune_label_filter } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Name is required' }); return;
    }
    if (!['stack', 'fleet', 'system'].includes(target_type)) {
      res.status(400).json({ error: 'Invalid target_type. Must be stack, fleet, or system.' }); return;
    }
    if (!['restart', 'snapshot', 'prune', 'update'].includes(action)) {
      res.status(400).json({ error: 'Invalid action. Must be restart, snapshot, prune, or update.' }); return;
    }
    // Tier gate based on action type
    if (!requireScheduledTaskTier(action, req, res)) return;
    // Validate action-target combos
    if (action === 'restart' && target_type !== 'stack') {
      res.status(400).json({ error: 'Restart action requires target_type "stack".' }); return;
    }
    if (action === 'update' && target_type !== 'stack') {
      res.status(400).json({ error: 'Update action requires target_type "stack".' }); return;
    }
    if (action === 'snapshot' && target_type !== 'fleet') {
      res.status(400).json({ error: 'Snapshot action requires target_type "fleet".' }); return;
    }
    if (action === 'prune' && target_type !== 'system') {
      res.status(400).json({ error: 'Prune action requires target_type "system".' }); return;
    }
    if (target_type === 'stack' && (!target_id || !node_id)) {
      res.status(400).json({ error: 'Stack operations require target_id and node_id.' }); return;
    }
    // Validate prune targets
    const validPruneTargets = ['containers', 'images', 'networks', 'volumes'];
    if (prune_targets !== undefined && prune_targets !== null) {
      if (!Array.isArray(prune_targets) || prune_targets.length === 0 || !prune_targets.every((t: string) => validPruneTargets.includes(t))) {
        res.status(400).json({ error: 'prune_targets must be a non-empty array of: containers, images, networks, volumes' }); return;
      }
    }
    // Validate target_services
    if (target_services !== undefined && target_services !== null) {
      if (!Array.isArray(target_services) || target_services.length === 0 || !target_services.every((s: unknown) => typeof s === 'string' && s.length > 0)) {
        res.status(400).json({ error: 'target_services must be a non-empty array of service name strings' }); return;
      }
      if (action !== 'restart' || target_type !== 'stack') {
        res.status(400).json({ error: 'target_services can only be used with restart action on stack target' }); return;
      }
    }
    // Validate prune_label_filter
    if (prune_label_filter !== undefined && prune_label_filter !== null) {
      if (typeof prune_label_filter !== 'string' || prune_label_filter.trim().length === 0) {
        res.status(400).json({ error: 'prune_label_filter must be a non-empty string' }); return;
      }
      if (action !== 'prune') {
        res.status(400).json({ error: 'prune_label_filter can only be used with prune action' }); return;
      }
    }
    // Validate cron expression
    try { CronExpressionParser.parse(cron_expression); } catch (e) {
      console.warn('[Scheduler] Invalid cron expression rejected:', cron_expression, (e as Error).message);
      res.status(400).json({ error: 'Invalid cron expression.' }); return;
    }

    const scheduler = SchedulerService.getInstance();
    const now = Date.now();
    const nextRun = (enabled !== false) ? scheduler.calculateNextRun(cron_expression) : null;

    const id = DatabaseService.getInstance().createScheduledTask({
      name: name.trim(),
      target_type,
      target_id: target_id || null,
      node_id: node_id != null ? Number(node_id) : null,
      action,
      cron_expression,
      enabled: enabled !== false ? 1 : 0,
      created_by: req.user?.username || 'admin',
      created_at: now,
      updated_at: now,
      last_run_at: null,
      next_run_at: nextRun,
      last_status: null,
      last_error: null,
      prune_targets: prune_targets ? JSON.stringify(prune_targets) : null,
      target_services: target_services ? JSON.stringify(target_services) : null,
      prune_label_filter: prune_label_filter ? prune_label_filter.trim() : null,
    });

    console.log(`[ScheduledTasks] Created task id=${id} action=${action} target=${target_id || 'none'}`);
    const task = DatabaseService.getInstance().getScheduledTask(id);
    res.status(201).json(task);
  } catch (error) {
    console.error('[ScheduledTasks] Create error:', error);
    res.status(500).json({ error: 'Failed to create scheduled task' });
  }
});

app.get('/api/scheduled-tasks/:id', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }
    const task = DatabaseService.getInstance().getScheduledTask(id);
    if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(task.action, req, res)) return;
    res.json(task);
  } catch (error) {
    console.error('[ScheduledTasks] Get error:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled task' });
  }
});

app.put('/api/scheduled-tasks/:id', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }

    const db = DatabaseService.getInstance();
    const existing = db.getScheduledTask(id);
    if (!existing) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(existing.action, req, res)) return;

    const { name, target_type, target_id, node_id, action, cron_expression, enabled, prune_targets, target_services, prune_label_filter } = req.body;

    if (target_type && !['stack', 'fleet', 'system'].includes(target_type)) {
      res.status(400).json({ error: 'Invalid target_type' }); return;
    }
    if (action && !['restart', 'snapshot', 'prune', 'update'].includes(action)) {
      res.status(400).json({ error: 'Invalid action' }); return;
    }

    const finalAction = action || existing.action;
    const finalTargetType = target_type || existing.target_type;
    if (finalAction === 'restart' && finalTargetType !== 'stack') {
      res.status(400).json({ error: 'Restart action requires target_type "stack".' }); return;
    }
    if (finalAction === 'update' && finalTargetType !== 'stack') {
      res.status(400).json({ error: 'Update action requires target_type "stack".' }); return;
    }
    if (finalAction === 'snapshot' && finalTargetType !== 'fleet') {
      res.status(400).json({ error: 'Snapshot action requires target_type "fleet".' }); return;
    }
    if (finalAction === 'prune' && finalTargetType !== 'system') {
      res.status(400).json({ error: 'Prune action requires target_type "system".' }); return;
    }

    // Validate prune targets
    const validPruneTargets = ['containers', 'images', 'networks', 'volumes'];
    if (prune_targets !== undefined && prune_targets !== null) {
      if (!Array.isArray(prune_targets) || prune_targets.length === 0 || !prune_targets.every((t: string) => validPruneTargets.includes(t))) {
        res.status(400).json({ error: 'prune_targets must be a non-empty array of: containers, images, networks, volumes' }); return;
      }
    }
    // Validate target_services
    if (target_services !== undefined && target_services !== null) {
      if (!Array.isArray(target_services) || target_services.length === 0 || !target_services.every((s: unknown) => typeof s === 'string' && s.length > 0)) {
        res.status(400).json({ error: 'target_services must be a non-empty array of service name strings' }); return;
      }
      if (finalAction !== 'restart' || finalTargetType !== 'stack') {
        res.status(400).json({ error: 'target_services can only be used with restart action on stack target' }); return;
      }
    }
    // Validate prune_label_filter
    if (prune_label_filter !== undefined && prune_label_filter !== null) {
      if (typeof prune_label_filter !== 'string' || prune_label_filter.trim().length === 0) {
        res.status(400).json({ error: 'prune_label_filter must be a non-empty string' }); return;
      }
      if (finalAction !== 'prune') {
        res.status(400).json({ error: 'prune_label_filter can only be used with prune action' }); return;
      }
    }

    if (cron_expression) {
      try { CronExpressionParser.parse(cron_expression); } catch (e) {
        console.warn('[Scheduler] Invalid cron expression rejected:', cron_expression, (e as Error).message);
        res.status(400).json({ error: 'Invalid cron expression.' }); return;
      }
    }

    const updates: Record<string, unknown> = { updated_at: Date.now() };
    if (name !== undefined) updates.name = typeof name === 'string' ? name.trim() : name;
    if (target_type !== undefined) updates.target_type = target_type;
    if (target_id !== undefined) updates.target_id = target_id || null;
    if (node_id !== undefined) updates.node_id = node_id != null ? Number(node_id) : null;
    if (action !== undefined) updates.action = action;
    if (cron_expression !== undefined) updates.cron_expression = cron_expression;
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;
    if (prune_targets !== undefined) updates.prune_targets = prune_targets ? JSON.stringify(prune_targets) : null;
    if (target_services !== undefined) updates.target_services = target_services ? JSON.stringify(target_services) : null;
    if (prune_label_filter !== undefined) updates.prune_label_filter = prune_label_filter ? prune_label_filter.trim() : null;

    // Recalculate next_run if cron changed or if enabling
    const finalCron = cron_expression || existing.cron_expression;
    const finalEnabled = enabled !== undefined ? enabled : existing.enabled;
    if (finalEnabled) {
      updates.next_run_at = SchedulerService.getInstance().calculateNextRun(finalCron);
    } else {
      updates.next_run_at = null;
    }

    db.updateScheduledTask(id, updates as Partial<Omit<ScheduledTask, 'id'>>);
    console.log(`[ScheduledTasks] Updated task id=${id}`);
    const task = db.getScheduledTask(id);
    res.json(task);
  } catch (error) {
    console.error('[ScheduledTasks] Update error:', error);
    res.status(500).json({ error: 'Failed to update scheduled task' });
  }
});

app.delete('/api/scheduled-tasks/:id', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }

    const db = DatabaseService.getInstance();
    const existing = db.getScheduledTask(id);
    if (!existing) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(existing.action, req, res)) return;

    db.deleteScheduledTask(id);
    console.log(`[ScheduledTasks] Deleted task id=${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[ScheduledTasks] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete scheduled task' });
  }
});

app.patch('/api/scheduled-tasks/:id/toggle', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }

    const db = DatabaseService.getInstance();
    const existing = db.getScheduledTask(id);
    if (!existing) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(existing.action, req, res)) return;

    const newEnabled = existing.enabled ? 0 : 1;
    const nextRun = newEnabled ? SchedulerService.getInstance().calculateNextRun(existing.cron_expression) : null;

    db.updateScheduledTask(id, {
      enabled: newEnabled,
      next_run_at: nextRun,
      updated_at: Date.now(),
    });

    console.log(`[ScheduledTasks] Toggled task id=${id} enabled=${newEnabled}`);
    const task = db.getScheduledTask(id);
    res.json(task);
  } catch (error) {
    console.error('[ScheduledTasks] Toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle scheduled task' });
  }
});

app.post('/api/scheduled-tasks/:id/run', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }

    const db = DatabaseService.getInstance();
    const existing = db.getScheduledTask(id);
    if (!existing) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(existing.action, req, res)) return;

    const scheduler = SchedulerService.getInstance();
    if (scheduler.isTaskRunning(id)) {
      res.status(409).json({ error: 'Task is already running' }); return;
    }

    console.log(`[ScheduledTasks] Manual run requested for task id=${id}`);
    scheduler.triggerTask(id).catch((err: unknown) => {
      const msg = getErrorMessage(err, String(err));
      console.error(`[ScheduledTasks] Background run error for task ${id}:`, msg);
    });

    res.status(202).json({ message: 'Task triggered', task_id: id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to run task';
    console.error('[ScheduledTasks] Run error:', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/scheduled-tasks/:id/runs/export', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }

    const db = DatabaseService.getInstance();
    const task = db.getScheduledTask(id);
    if (!task) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(task.action, req, res)) return;

    const runs = db.getAllScheduledTaskRuns(id);

    const escapeCsv = (val: string): string => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const lines = ['Timestamp,Source,Status,Duration (s),Details'];
    for (const run of runs) {
      const timestamp = new Date(run.started_at).toISOString();
      const source = run.triggered_by === 'manual' ? 'Manual' : 'Scheduled';
      const status = run.status.charAt(0).toUpperCase() + run.status.slice(1);
      const duration = run.completed_at && run.started_at
        ? ((run.completed_at - run.started_at) / 1000).toFixed(1)
        : '';
      const details = run.error || run.output || '';
      lines.push(`${escapeCsv(timestamp)},${escapeCsv(source)},${escapeCsv(status)},${escapeCsv(duration)},${escapeCsv(details)}`);
    }

    const safeName = task.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="task-${safeName}-history.csv"`);
    res.send(lines.join('\n'));
  } catch (error) {
    console.error('[ScheduledTasks] Export error:', error);
    res.status(500).json({ error: 'Failed to export task runs' });
  }
});

app.get('/api/scheduled-tasks/:id/runs', (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid task ID' }); return; }

    const db = DatabaseService.getInstance();
    const existing = db.getScheduledTask(id);
    if (!existing) { res.status(404).json({ error: 'Scheduled task not found' }); return; }
    if (!requireScheduledTaskTier(existing.action, req, res)) return;

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const result = db.getScheduledTaskRuns(id, limit, offset);
    res.json(result);
  } catch (error) {
    console.error('[ScheduledTasks] Runs error:', error);
    res.status(500).json({ error: 'Failed to fetch task runs' });
  }
});

// --- Private Registry Routes (Admiral, admin-only, local-only) ---

const VALID_REGISTRY_TYPES = ['dockerhub', 'ghcr', 'ecr', 'custom'] as const;

function isValidRegistryUrl(url: string, type: string): boolean {
  // Docker Hub is fixed server-side to the legacy URL; no validation needed.
  if (type === 'dockerhub') return true;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Reject any non-http(s) scheme (file://, ftp://, javascript:, etc.).
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.startsWith('ftp:')) {
    return false;
  }
  // Parse with a default https:// prefix so bare hosts validate.
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!parsed.hostname) return false;
  } catch {
    return false;
  }
  return true;
}

app.get('/api/registries', (req: Request, res: Response): void => {
  if (req.apiTokenScope) { res.status(403).json({ error: 'API tokens cannot manage registry credentials.', code: 'SCOPE_DENIED' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    res.json(RegistryService.getInstance().getAll());
  } catch (error) {
    console.error('[Registries] List error:', error);
    res.status(500).json({ error: 'Failed to fetch registries' });
  }
});

app.post('/api/registries', (req: Request, res: Response): void => {
  if (req.apiTokenScope) { res.status(403).json({ error: 'API tokens cannot manage registry credentials.', code: 'SCOPE_DENIED' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const { name, url, type, username, secret, aws_region } = req.body;

    if (!name || typeof name !== 'string' || name.length > 100) {
      res.status(400).json({ error: 'Name is required (max 100 characters).' }); return;
    }
    if (!url || typeof url !== 'string' || url.length > 500) {
      res.status(400).json({ error: 'URL is required (max 500 characters).' }); return;
    }
    if (!type || !VALID_REGISTRY_TYPES.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${VALID_REGISTRY_TYPES.join(', ')}` }); return;
    }
    if (!isValidRegistryUrl(url, type)) {
      res.status(400).json({ error: 'Registry URL must use http:// or https:// (or no protocol).' }); return;
    }
    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required.' }); return;
    }
    if (!secret || typeof secret !== 'string') {
      res.status(400).json({ error: 'Secret/token is required.' }); return;
    }
    if (type === 'ecr' && (!aws_region || typeof aws_region !== 'string')) {
      res.status(400).json({ error: 'AWS region is required for ECR registries.' }); return;
    }

    const id = RegistryService.getInstance().create({ name, url, type, username, secret, aws_region: aws_region ?? null });
    res.status(201).json({ id });
  } catch (error) {
    console.error('[Registries] Create error:', error);
    res.status(500).json({ error: 'Failed to create registry' });
  }
});

app.put('/api/registries/:id', (req: Request, res: Response): void => {
  if (req.apiTokenScope) { res.status(403).json({ error: 'API tokens cannot manage registry credentials.', code: 'SCOPE_DENIED' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid registry ID' }); return; }

    const existing = RegistryService.getInstance().getById(id);
    if (!existing) { res.status(404).json({ error: 'Registry not found' }); return; }

    const { name, url, type, username, secret, aws_region } = req.body;

    if (name !== undefined && (typeof name !== 'string' || name.length > 100)) {
      res.status(400).json({ error: 'Name must be a string (max 100 characters).' }); return;
    }
    if (url !== undefined && (typeof url !== 'string' || url.length > 500)) {
      res.status(400).json({ error: 'URL must be a string (max 500 characters).' }); return;
    }
    if (type !== undefined && !VALID_REGISTRY_TYPES.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${VALID_REGISTRY_TYPES.join(', ')}` }); return;
    }
    const effectiveType = type ?? existing.type;
    if (url !== undefined && !isValidRegistryUrl(url, effectiveType)) {
      res.status(400).json({ error: 'Registry URL must use http:// or https:// (or no protocol).' }); return;
    }
    if (effectiveType === 'ecr' && aws_region !== undefined && (typeof aws_region !== 'string' || !aws_region)) {
      res.status(400).json({ error: 'AWS region is required for ECR registries.' }); return;
    }

    RegistryService.getInstance().update(id, { name, url, type, username, secret, aws_region });
    res.json({ success: true });
  } catch (error) {
    console.error('[Registries] Update error:', error);
    res.status(500).json({ error: 'Failed to update registry' });
  }
});

app.delete('/api/registries/:id', (req: Request, res: Response): void => {
  if (req.apiTokenScope) { res.status(403).json({ error: 'API tokens cannot manage registry credentials.', code: 'SCOPE_DENIED' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid registry ID' }); return; }

    const existing = RegistryService.getInstance().getById(id);
    if (!existing) { res.status(404).json({ error: 'Registry not found' }); return; }

    RegistryService.getInstance().delete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Registries] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete registry' });
  }
});

app.post('/api/registries/:id/test', async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) { res.status(403).json({ error: 'API tokens cannot manage registry credentials.', code: 'SCOPE_DENIED' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid registry ID' }); return; }

    const result = await RegistryService.getInstance().testConnection(id);
    res.json(result);
  } catch (error) {
    console.error('[Registries] Test error:', error);
    res.status(500).json({ error: 'Failed to test registry connection' });
  }
});

// Stateless test: validate credentials without persisting. Powers the
// "Test connection" button inside the create/edit form so users can verify
// creds before saving.
app.post('/api/registries/test', async (req: Request, res: Response): Promise<void> => {
  if (req.apiTokenScope) { res.status(403).json({ error: 'API tokens cannot manage registry credentials.', code: 'SCOPE_DENIED' }); return; }
  if (!requireAdmin(req, res)) return;
  if (!requireAdmiral(req, res)) return;
  try {
    const { type, url, username, secret, aws_region } = req.body;

    if (!type || !VALID_REGISTRY_TYPES.includes(type)) {
      res.status(400).json({ error: `Type must be one of: ${VALID_REGISTRY_TYPES.join(', ')}` }); return;
    }
    if (typeof url !== 'string' || url.length === 0 || url.length > 500) {
      res.status(400).json({ error: 'URL is required (max 500 characters).' }); return;
    }
    if (!isValidRegistryUrl(url, type)) {
      res.status(400).json({ error: 'Registry URL must use http:// or https:// (or no protocol).' }); return;
    }
    if (typeof username !== 'string' || username.length === 0) {
      res.status(400).json({ error: 'Username is required.' }); return;
    }
    if (typeof secret !== 'string' || secret.length === 0) {
      res.status(400).json({ error: 'Secret/token is required.' }); return;
    }
    if (type === 'ecr' && (typeof aws_region !== 'string' || !aws_region)) {
      res.status(400).json({ error: 'AWS region is required for ECR registries.' }); return;
    }

    const result = await RegistryService.getInstance().testWithCredentials({
      type,
      url,
      username,
      secret,
      aws_region: aws_region ?? null,
    });
    res.json(result);
  } catch (error) {
    console.error('[Registries] Stateless test error:', error);
    res.status(500).json({ error: 'Failed to test registry connection' });
  }
});

// --- System Maintenance Routes (The System Janitor) ---

app.get('/api/system/orphans', async (req: Request, res: Response) => {
  try {
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const dockerController = DockerController.getInstance(req.nodeId);
    const orphans = await dockerController.getOrphanContainers(knownStacks);
    res.json(orphans);
  } catch (error) {
    console.error('Failed to fetch orphan containers:', error);
    res.status(500).json({ error: 'Failed to fetch orphan containers' });
  }
});

app.post('/api/system/prune/orphans', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { containerIds } = req.body;
    if (!Array.isArray(containerIds)) {
      return res.status(400).json({ error: 'containerIds must be an array' });
    }
    const invalidIds = containerIds.filter((id: unknown) => typeof id !== 'string' || !isValidDockerResourceId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: 'One or more container IDs have an invalid format' });
    }
    console.log(`[Resources] Prune orphans: ${containerIds.length} container(s) requested`);
    const dockerController = DockerController.getInstance(req.nodeId);
    const results = await dockerController.removeContainers(containerIds);
    const succeeded = results.filter((r: { success: boolean }) => r.success).length;
    console.log(`[Resources] Prune orphans completed: ${succeeded}/${containerIds.length} removed`);
    invalidateNodeCaches(req.nodeId);
    res.json({ results });
  } catch (error) {
    console.error('Failed to prune orphan containers:', error);
    res.status(500).json({ error: 'Failed to prune orphan containers' });
  }
});

app.post('/api/system/prune/system', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { target, scope } = req.body as { target: string; scope?: string };
    if (!['containers', 'images', 'networks', 'volumes'].includes(target)) {
      return res.status(400).json({ error: 'Invalid prune target' });
    }

    const pruneScope = scope === 'managed' ? 'managed' : 'all';
    console.log(`[Resources] System prune: ${target} (scope: ${pruneScope})`);
    const dockerController = DockerController.getInstance(req.nodeId);

    let result: { success: boolean; reclaimedBytes: number };
    if (pruneScope === 'managed' && target !== 'containers') {
      const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
      result = await dockerController.pruneManagedOnly(
        target as 'images' | 'volumes' | 'networks',
        knownStacks
      );
    } else {
      result = await dockerController.pruneSystem(target as 'containers' | 'images' | 'networks' | 'volumes');
    }

    console.log(`[Resources] System prune completed: ${target}, reclaimed ${result.reclaimedBytes} bytes`);
    if (target === 'containers') {
      invalidateNodeCaches(req.nodeId);
    }
    res.json({ message: 'Prune completed', ...result });
  } catch (error: unknown) {
    console.error('System prune error:', error);
    res.status(500).json({ error: 'System prune failed' });
  }
});

app.get('/api/system/docker-df', async (req: Request, res: Response) => {
  try {
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const df = await DockerController.getInstance(req.nodeId).getDiskUsageClassified(knownStacks);
    res.json(df);
  } catch (error) {
    console.error('Failed to fetch docker disk usage:', error);
    res.status(500).json({ error: 'Failed to fetch docker disk usage' });
  }
});

// Single endpoint returning classified images, volumes, and networks in one call
app.get('/api/system/resources', async (req: Request, res: Response) => {
  try {
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const result = await DockerController.getInstance(req.nodeId).getClassifiedResources(knownStacks);
    res.json(result);
  } catch (error) {
    console.error('Failed to fetch classified resources:', error);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// Keep legacy endpoints for backward compat with remote proxy routing
app.get('/api/system/images', async (req: Request, res: Response) => {
  try {
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const { images } = await DockerController.getInstance(req.nodeId).getClassifiedResources(knownStacks);
    res.json(images);
  } catch (error) {
    console.error('Failed to fetch images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

app.get('/api/system/volumes', async (req: Request, res: Response) => {
  try {
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const { volumes } = await DockerController.getInstance(req.nodeId).getClassifiedResources(knownStacks);
    res.json(volumes);
  } catch (error) {
    console.error('Failed to fetch volumes:', error);
    res.status(500).json({ error: 'Failed to fetch volumes' });
  }
});

app.get('/api/system/networks', async (req: Request, res: Response) => {
  try {
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const { networks } = await DockerController.getInstance(req.nodeId).getClassifiedResources(knownStacks);
    res.json(networks);
  } catch (error) {
    console.error('Failed to fetch networks:', error);
    res.status(500).json({ error: 'Failed to fetch networks' });
  }
});

app.post('/api/system/images/delete', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    if (typeof id !== 'string' || !isValidDockerResourceId(id)) {
      return res.status(400).json({ error: 'Invalid image ID format' });
    }
    console.log(`[Resources] Delete image: ${id.substring(0, 12)}`);
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.removeImage(id);
    invalidateNodeCaches(req.nodeId);
    res.json({ success: true, message: 'Image deleted' });
  } catch (error: unknown) {
    console.error('Failed to delete image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

app.post('/api/system/volumes/delete', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { id } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Volume name is required' });
    console.log(`[Resources] Delete volume: ${id}`);
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.removeVolume(id);
    invalidateNodeCaches(req.nodeId);
    res.json({ success: true, message: 'Volume deleted' });
  } catch (error: unknown) {
    console.error('Failed to delete volume:', error);
    res.status(500).json({ error: 'Failed to delete volume' });
  }
});

app.post('/api/system/networks/delete', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    if (typeof id !== 'string' || !isValidDockerResourceId(id)) {
      return res.status(400).json({ error: 'Invalid network ID format' });
    }
    console.log(`[Resources] Delete network: ${id.substring(0, 12)}`);
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.removeNetwork(id);
    invalidateNodeCaches(req.nodeId);
    res.json({ success: true, message: 'Network deleted' });
  } catch (error: unknown) {
    console.error('Failed to delete network:', error);
    res.status(500).json({ error: 'Failed to delete network' });
  }
});

app.get('/api/system/networks/topology', async (req: Request, res: Response) => {
  if (!requirePaid(req, res)) return;
  try {
    const includeSystem = req.query.includeSystem === 'true';
    const knownStacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    const dockerController = DockerController.getInstance(req.nodeId);
    const topology = await dockerController.getTopologyData(knownStacks, includeSystem);
    console.log(`[Resources] Topology fetched: ${topology.length} networks, includeSystem=${includeSystem}`);
    if (isDebugEnabled()) console.debug('[Resources:debug] Topology fetched', { networkCount: topology.length, includeSystem });
    res.json(topology);
  } catch (error: unknown) {
    console.error('Failed to fetch network topology:', error);
    res.status(500).json({ error: 'Failed to fetch network topology' });
  }
});

app.get('/api/system/networks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!id) return res.status(400).json({ error: 'Network ID is required' });
    const dockerController = DockerController.getInstance(req.nodeId);
    const networkInfo = await dockerController.inspectNetwork(id);
    res.json(networkInfo);
  } catch (error: unknown) {
    console.error('Failed to inspect network:', error);
    const err = error as Record<string, unknown>;
    const is404 = (typeof err.statusCode === 'number' && err.statusCode === 404)
      || (error instanceof Error && error.message.includes('404'));
    res.status(is404 ? 404 : 500).json({ error: is404 ? 'Network not found' : 'Failed to inspect network' });
  }
});

app.post('/api/system/networks', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { name, driver, subnet, gateway, labels, internal, attachable } = req.body;
    if (!name) return res.status(400).json({ error: 'Network name is required' });

    const options: CreateNetworkOptions = { Name: name };

    const VALID_DRIVERS: NetworkDriver[] = ['bridge', 'overlay', 'macvlan', 'host', 'none'];
    if (driver) {
      if (!VALID_DRIVERS.includes(driver)) return res.status(400).json({ error: 'Invalid network driver' });
      options.Driver = driver;
    }
    if (subnet || gateway) {
      if (subnet && !isValidCidr(subnet)) return res.status(400).json({ error: 'Invalid subnet CIDR notation (e.g. 172.20.0.0/16)' });
      if (gateway && !isValidIPv4(gateway)) return res.status(400).json({ error: 'Invalid gateway IP address (e.g. 172.20.0.1)' });
      options.IPAM = { Config: [{}] };
      if (subnet) options.IPAM.Config[0].Subnet = subnet;
      if (gateway) options.IPAM.Config[0].Gateway = gateway;
    }
    if (labels && typeof labels === 'object' && !Array.isArray(labels)) options.Labels = labels;
    if (internal) options.Internal = true;
    if (attachable) options.Attachable = true;

    const dockerController = DockerController.getInstance(req.nodeId);
    const network = await dockerController.createNetwork(options);
    console.log(`[Resources] Network created: ${name}`);
    invalidateNodeCaches(req.nodeId);
    res.status(201).json({ success: true, message: 'Network created', id: network.id });
  } catch (error: unknown) {
    console.error('Failed to create network:', error);
    const msg = getErrorMessage(error, '');
    const safePatterns = ['already exists', 'name is invalid', 'invalid network name'];
    const lowerMsg = msg.toLowerCase();
    const isSafe = safePatterns.some(p => lowerMsg.includes(p));
    res.status(isSafe ? 409 : 500).json({ error: isSafe ? msg : 'Failed to create network' });
  }
});

// --- App Templates Routes ---

app.get('/api/templates', authMiddleware, async (req: Request, res: Response) => {
  try {
    const templates = await templateService.getTemplates();
    res.json(templates);
  } catch (error) {
    console.error('[Templates] Failed to fetch:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

app.post('/api/templates/refresh-cache', authMiddleware, (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  templateService.clearCache();
  console.log('[Templates] Cache cleared by', req.user?.username || 'unknown');
  res.json({ success: true });
});

app.post('/api/templates/deploy', authMiddleware, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { stackName, template, envVars } = req.body;

    if (!stackName || !template) {
      return res.status(400).json({ error: 'stackName and template are required' });
    }

    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Stack name can only contain alphanumeric characters, hyphens, and underscores' });
    }

    const fsService = FileSystemService.getInstance(req.nodeId);
    const baseDir = fsService.getBaseDir();
    const stackPath = path.join(baseDir, stackName);
    if (!isPathWithinBase(stackPath, baseDir)) {
      return res.status(400).json({ error: 'Invalid stack path' });
    }

    try {
      await fsPromises.access(stackPath);

      if (await fsService.hasComposeFile(stackPath)) {
        return res.status(409).json({
          error: `A stack directory named '${stackName}' already exists. Please choose a different Stack Name.`,
          rolledBack: false
        });
      }

      // Orphaned directory left by external deletion (e.g. Docker Desktop).
      console.log(`[Templates] Cleaned up orphaned stack directory: ${stackName}`);
      await fsService.deleteStack(stackName);
    } catch {
      // Directory does not exist; proceed with deploy
    }

    const debug = isDebugEnabled();
    console.log(`[Templates] Deploy started: ${stackName}`);
    if (debug) console.debug('[Templates:debug] Deploy payload', { stackName, templateTitle: template.title, envVarCount: envVars ? Object.keys(envVars).length : 0 });

    // 1. Create stack directory
    await fsService.createStack(stackName);

    // 2. Generate compose YAML and save
    const composeYaml = templateService.generateComposeFromTemplate(template);
    await fsService.saveStackContent(stackName, composeYaml);

    // 3. Generate env string and save to default .env
    if (envVars && Object.keys(envVars).length > 0) {
      const envString = templateService.generateEnvString(envVars);
      const defaultEnvPath = path.join(stackPath, '.env');
      await fsPromises.writeFile(defaultEnvPath, envString, 'utf-8');
    }

    // 4. Deploy the stack with atomic rollback
    try {
      const atomic = LicenseService.getInstance().getTier() === 'paid';
      await ComposeService.getInstance(req.nodeId).deployStack(stackName, terminalWs || undefined, atomic);
      invalidateNodeCaches(req.nodeId);
      console.log(`[Templates] Deploy completed: ${stackName}`);
      res.json({ success: true, message: 'Template deployed successfully' });
    } catch (deployError: unknown) {
      const rawError = getErrorMessage(deployError, String(deployError));
      console.error(`[Templates] Deploy failed: ${stackName} -`, rawError);
      const parsed = ErrorParser.parse(rawError);

      const shouldRollback = parsed.rule ? parsed.rule.canSilentlyRollback : true;

      if (shouldRollback) {
        try {
          // Stage 1: Tell Docker to clean up ghost networks/containers
          await ComposeService.getInstance(req.nodeId).downStack(stackName);
        } catch (downErr) {
          console.error("[Templates] Rollback Stage 1 (Docker down) failed:", downErr);
        }

        try {
          // Stage 2: Remove the stack files
          await fsService.deleteStack(stackName);
        } catch (fsErr) {
          console.error("[Templates] Rollback Stage 2 (File deletion) failed:", fsErr);
        }
      }

      // Partial state may linger (directory created, deploy failed, rollback
      // may or may not have cleaned up). Drop node caches either way.
      invalidateNodeCaches(req.nodeId);
      res.status(500).json({
        error: parsed.message,
        rolledBack: shouldRollback,
        ruleId: parsed.rule?.id || 'UNKNOWN'
      });
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to deploy template');
    console.error('[Templates] Deploy error:', message);
    res.status(500).json({ error: message });
  }
});

// =========================
// Image Update Checker API
// =========================

app.get('/api/image-updates', authMiddleware, (req: Request, res: Response) => {
  try {
    const updates = DatabaseService.getInstance().getStackUpdateStatus(req.nodeId);
    res.json(updates);
  } catch (error) {
    console.error('Failed to fetch image update status:', error);
    res.status(500).json({ error: 'Failed to fetch image update status' });
  }
});

app.post('/api/image-updates/refresh', authMiddleware, (_req: Request, res: Response) => {
  if (!requireAdmin(_req, res)) return;
  try {
    const triggered = ImageUpdateService.getInstance().triggerManualRefresh();
    if (!triggered) {
      const mins = ImageUpdateService.manualCooldownMinutes;
      res.status(429).json({ error: `Rate limited. Please wait at least ${mins} minute${mins !== 1 ? 's' : ''} between manual refreshes.` });
      return;
    }
    res.json({ success: true, message: 'Image update check started in background.' });
  } catch (error) {
    console.error('Failed to trigger image update refresh:', error);
    res.status(500).json({ error: 'Failed to trigger refresh' });
  }
});

app.get('/api/image-updates/status', authMiddleware, (_req: Request, res: Response) => {
  res.json({ checking: ImageUpdateService.getInstance().isChecking() });
});

// Fleet-wide image update aggregation (local DB + remote node APIs)
const FLEET_UPDATE_CACHE_KEY = 'fleet-updates';
const FLEET_CACHE_TTL = 120_000; // 2 minutes

app.get('/api/image-updates/fleet', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const result = await CacheService.getInstance().getOrFetch<Record<number, Record<string, boolean>>>(
      FLEET_UPDATE_CACHE_KEY,
      FLEET_CACHE_TTL,
      async () => {
        const db = DatabaseService.getInstance();
        const nodes = db.getNodes();
        const nr = NodeRegistry.getInstance();
        const data: Record<number, Record<string, boolean>> = {};

        // Local nodes: synchronous DB reads
        for (const node of nodes) {
          if (node.type === 'local') {
            data[node.id] = db.getStackUpdateStatus(node.id);
          }
        }

        // Remote nodes: parallel fetches with individual timeouts
        const remoteNodes = nodes.filter(n => n.type === 'remote' && n.status === 'online' && n.api_url);
        const remoteResults = await Promise.allSettled(
          remoteNodes.map(async (node) => {
            const proxyTarget = nr.getProxyTarget(node.id);
            const baseUrl = node.api_url!.replace(/\/$/, '');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
              const resp = await fetch(`${baseUrl}/api/image-updates`, {
                headers: proxyTarget?.apiToken
                  ? { Authorization: `Bearer ${proxyTarget.apiToken}` }
                  : {},
                signal: controller.signal,
              });
              clearTimeout(timeout);
              if (resp.ok) return { nodeId: node.id, data: await resp.json() as Record<string, boolean> };
            } catch {
              clearTimeout(timeout);
            }
            return null;
          })
        );

        for (const entry of remoteResults) {
          if (entry.status === 'fulfilled' && entry.value) {
            data[entry.value.nodeId] = entry.value.data;
          }
        }

        return data;
      },
    );
    res.json(result);
  } catch (error) {
    console.error('Failed to aggregate fleet update status:', error);
    res.status(500).json({ error: 'Failed to aggregate fleet update status' });
  }
});

// =========================
// Auto-Update Execution API
// =========================

// Execute auto-update for a single stack (or all stacks with target "*").
// This runs locally on whichever Sencho instance receives the request.
// The gateway scheduler proxies this to remote nodes via HTTP.
app.post('/api/auto-update/execute', authMiddleware, async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const { target } = req.body as { target?: string };
    console.log(`[AutoUpdate] Execute requested: target="${target || ''}"`);
    if (!target || typeof target !== 'string') {
      return res.status(400).json({ error: 'Missing "target" (stack name or "*" for all)' });
    }

    let stackNames: string[];
    if (target === '*') {
      stackNames = await FileSystemService.getInstance(req.nodeId).getStacks();
      if (stackNames.length === 0) {
        return res.json({ result: 'No stacks found on node; skipped.' });
      }
    } else {
      if (!isValidStackName(target)) {
        return res.status(400).json({ error: 'Invalid stack name' });
      }
      stackNames = [target];
    }

    const docker = DockerController.getInstance(req.nodeId);
    const imageUpdateService = ImageUpdateService.getInstance();
    const compose = ComposeService.getInstance(req.nodeId);
    const db = DatabaseService.getInstance();
    const atomic = LicenseService.getInstance().getTier() === 'paid';
    const results: string[] = [];

    for (const stackName of stackNames) {
      try {
        const containers = await docker.getContainersByStack(stackName);
        if (!containers || containers.length === 0) {
          results.push(`Stack "${stackName}": no containers found; skipped.`);
          continue;
        }

        const imageRefs = [...new Set(
          containers
            .map((c: { Image?: string }) => c.Image)
            .filter((img): img is string => !!img && !img.startsWith('sha256:'))
        )];

        if (imageRefs.length === 0) {
          results.push(`Stack "${stackName}": no pullable images; skipped.`);
          continue;
        }

        let hasUpdate = false;
        const updatedImages: string[] = [];
        const checkErrors: string[] = [];
        for (const imageRef of imageRefs) {
          try {
            const result = await imageUpdateService.checkImage(docker, imageRef);
            if (result.error) {
              checkErrors.push(result.error);
            } else if (result.hasUpdate) {
              hasUpdate = true;
              updatedImages.push(imageRef);
            }
          } catch (e) {
            const errMsg = getErrorMessage(e, String(e));
            checkErrors.push(errMsg);
            console.warn(`[AutoUpdate] Failed to check image ${imageRef}:`, e);
          }
        }

        if (!hasUpdate) {
          if (checkErrors.length > 0 && checkErrors.length === imageRefs.length) {
            results.push(`Stack "${stackName}": WARNING - all image checks failed (${checkErrors.join('; ')}). Unable to determine update status.`);
          } else if (checkErrors.length > 0) {
            results.push(`Stack "${stackName}": all reachable images up to date (${checkErrors.length} check(s) failed).`);
          } else {
            results.push(`Stack "${stackName}": all images up to date.`);
          }
          continue;
        }

        await compose.updateStack(stackName, undefined, atomic);
        db.clearStackUpdateStatus(req.nodeId, stackName);

        NotificationService.getInstance().dispatchAlert(
          'info',
          `Auto-update: stack "${stackName}" updated with new images`,
          stackName
        );

        results.push(`Stack "${stackName}": updated (${updatedImages.join(', ')}).`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push(`Stack "${stackName}" failed: ${msg}`);
        console.error(`[AutoUpdate] Failed for stack "${stackName}":`, e);
      }
    }

    res.json({ result: results.join('\n') });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Auto-update execution failed';
    console.error('[AutoUpdate] Execute error:', msg);
    res.status(500).json({ error: msg });
  }
});

// =========================
// Node Management API
// =========================


// List all nodes
app.get('/api/nodes', async (req: Request, res: Response) => {
  try {
    const nodes = DatabaseService.getInstance().getNodes();
    res.json(nodes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nodes' });
  }
});

// Per-node scheduling + update summary (must be before :id route)
app.get('/api/nodes/scheduling-summary', authMiddleware, (_req: Request, res: Response) => {
  try {
    const db = DatabaseService.getInstance();
    const scheduleSummary = db.getNodeSchedulingSummary();
    const updateSummary = db.getNodeUpdateSummary();

    const result: Record<number, {
      active_tasks: number;
      auto_update_enabled: boolean;
      next_run_at: number | null;
      stacks_with_updates: number;
    }> = {};

    for (const s of scheduleSummary) {
      result[s.node_id] = {
        active_tasks: s.active_tasks,
        auto_update_enabled: s.auto_update_enabled === 1,
        next_run_at: s.next_run_at,
        stacks_with_updates: 0,
      };
    }
    for (const u of updateSummary) {
      if (result[u.node_id]) {
        result[u.node_id].stacks_with_updates = u.stacks_with_updates;
      } else {
        result[u.node_id] = {
          active_tasks: 0,
          auto_update_enabled: false,
          next_run_at: null,
          stacks_with_updates: u.stacks_with_updates,
        };
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Failed to fetch node scheduling summary:', error);
    res.status(500).json({ error: 'Failed to fetch node scheduling summary' });
  }
});

// Get a specific node
app.get('/api/nodes/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const node = DatabaseService.getInstance().getNode(id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json(node);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch node' });
  }
});

// Create a new node
app.post('/api/nodes', async (req: Request, res: Response) => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage nodes.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requirePermission(req, res, 'node:manage')) return;
  try {
    const { name, type, compose_dir, is_default, api_url, api_token } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Node name is required' });
    }
    if (!type || !['local', 'remote'].includes(type)) {
      return res.status(400).json({ error: 'Node type must be "local" or "remote"' });
    }
    if (type === 'remote') {
      if (!api_url || typeof api_url !== 'string') {
        return res.status(400).json({ error: 'API URL is required for remote nodes' });
      }
      const urlCheck = isValidRemoteUrl(api_url);
      if (!urlCheck.valid) {
        return res.status(400).json({ error: urlCheck.reason });
      }
    }

    const id = DatabaseService.getInstance().addNode({
      name,
      type,
      compose_dir: compose_dir || '/app/compose',
      is_default: is_default || false,
      api_url: api_url || '',
      api_token: api_token || '',
    });

    // Notify subscribers (e.g. DockerEventManager) so a new local node gets
    // its event stream spun up immediately, not on next restart.
    NodeRegistry.getInstance().notifyNodeAdded(id);

    const isPlainHttp = type === 'remote' && api_url && api_url.startsWith('http://');
    res.json({
      success: true,
      id,
      ...(isPlainHttp && {
        warning: 'This node uses plain HTTP. Use HTTPS or a VPN for connections over the public internet.'
      })
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A node with that name already exists' });
    }
    console.error('Failed to create node:', error);
    res.status(500).json({ error: error.message || 'Failed to create node' });
  }
});

// Update a node
app.put('/api/nodes/:id', async (req: Request, res: Response) => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage nodes.', code: 'SCOPE_DENIED' });
    return;
  }
  const nodeId = req.params.id as string;
  if (!requirePermission(req, res, 'node:manage', 'node', nodeId)) return;
  try {
    const id = parseInt(nodeId);
    const updates = req.body;

    if (updates.api_url !== undefined && updates.api_url !== '') {
      const urlCheck = isValidRemoteUrl(updates.api_url);
      if (!urlCheck.valid) {
        return res.status(400).json({ error: urlCheck.reason });
      }
    }

    DatabaseService.getInstance().updateNode(id, updates);

    // Evict cached Docker connection so it reconnects with new config
    NodeRegistry.getInstance().evictConnection(id);
    NodeRegistry.getInstance().notifyNodeUpdated(id);

    const isPlainHttp = updates.api_url && updates.api_url.startsWith('http://');
    res.json({
      success: true,
      ...(isPlainHttp && {
        warning: 'This node uses plain HTTP. Use HTTPS or a VPN for connections over the public internet.'
      })
    });
  } catch (error: any) {
    console.error('Failed to update node:', error);
    res.status(500).json({ error: error.message || 'Failed to update node' });
  }
});

// Delete a node
app.delete('/api/nodes/:id', async (req: Request, res: Response) => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage nodes.', code: 'SCOPE_DENIED' });
    return;
  }
  const nodeIdParam = req.params.id as string;
  if (!requirePermission(req, res, 'node:manage', 'node', nodeIdParam)) return;
  try {
    const id = parseInt(nodeIdParam);
    DatabaseService.getInstance().deleteNode(id);
    NodeRegistry.getInstance().evictConnection(id);
    NodeRegistry.getInstance().notifyNodeRemoved(id);
    CacheService.getInstance().invalidate(`${REMOTE_META_NAMESPACE}:${id}`);
    updateTracker.delete(id);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Failed to delete node:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete node' });
  }
});

// Test connection to a node
app.post('/api/nodes/:id/test', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const result = await NodeRegistry.getInstance().testConnection(id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Connection test failed' });
  }
});

// Fetch capability metadata for a specific node. For local nodes, returns this
// instance's capabilities directly. For remote nodes, relays GET /api/meta from
// the remote Sencho instance. Backend-side cache (via CacheService) shields
// against rate limit contention on the remote and serves stale data on
// transient failures. Keys are "remote-meta:<nodeId>" so we can invalidate by
// namespace when a node is deleted.
const REMOTE_META_NAMESPACE = 'remote-meta';
const REMOTE_META_CACHE_TTL = 3 * 60 * 1000;

app.get('/api/nodes/:id/meta', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const node = DatabaseService.getInstance().getNode(id);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    if (node.type === 'local') {
      res.json({ version: getSenchoVersion(), capabilities: CAPABILITIES });
      return;
    }

    const baseUrl = node.api_url?.replace(/\/$/, '');
    if (!baseUrl || !node.api_token) {
      res.json({ version: null, capabilities: [] });
      return;
    }

    const cacheKey = `${REMOTE_META_NAMESPACE}:${id}`;
    const meta = await CacheService.getInstance().getOrFetch<RemoteMeta>(
      cacheKey,
      REMOTE_META_CACHE_TTL,
      async () => {
        const fetched = await fetchRemoteMeta(baseUrl, node.api_token!);
        // A successful fetch always includes a version; null version means the
        // remote was unreachable. Throw so CacheService serves stale on error
        // instead of caching an empty result.
        if (fetched.version === null) {
          throw new Error('Remote meta fetch returned null version');
        }
        return fetched;
      },
    );

    res.json(meta);
  } catch (error: unknown) {
    console.error('Failed to fetch node meta:', error);
    const message = getErrorMessage(error, 'Failed to fetch node metadata');
    res.status(500).json({ error: message });
  }
});


// Serve static files in production (for Docker deployment)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));

  // Handle SPA routing - serve index.html for non-API routes
  // Using app.use middleware instead of app.get('*') for path-to-regexp compatibility
  app.use((req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile('index.html', { root: 'public' });
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
} else {
  // In development, still need to catch 404s for API to prevent hangs
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
}

// Start server with migration
async function startServer() {
  try {
    // Run migration before starting server
    console.log('Running stack migration check...');
    const defaultFsService = FileSystemService.getInstance(NodeRegistry.getInstance().getDefaultNodeId());
    await defaultFsService.migrateFlatToDirectory();
    console.log('Migration check completed');
  } catch (error) {
    console.error('Migration failed:', error);
    // Continue starting server even if migration fails
  }

  // Initialize License Service (starts trial on first boot, periodic validation)
  LicenseService.getInstance().initialize();

  // Detect whether this instance can self-update (Docker Compose container inspection)
  await SelfUpdateService.getInstance().initialize();

  // Start Background Watchdog
  MonitorService.getInstance().start();

  // Start Docker Event Stream (causal crash/OOM/health detection per local node)
  await DockerEventManager.getInstance().start();

  // Start Background Image Update Checker
  ImageUpdateService.getInstance().start();

  // Start Scheduled Operations Service
  SchedulerService.getInstance().start();

  // Sweep any leftover git-source temp clones from a crashed prior run
  sweepStaleGitTempDirs().catch((err) => {
    console.warn('[GitSource] Temp dir sweep failed:', (err as Error).message);
  });

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Only start the server when this file is the entry point (not when imported by tests).
if (require.main === module) {
  startServer();
}

// Exports used by tests (supertest requires the http.Server instance).
export { app, server };

// Graceful shutdown - allows in-flight requests to finish, then cleanly stops
// background services and closes the SQLite connection before the process exits.
// Docker sends SIGTERM when the container stops; Ctrl-C sends SIGINT in dev.
const gracefulShutdown = (signal: string) => {
  console.log(`[Shutdown] ${signal} received - shutting down gracefully…`);

  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
    try { LicenseService.getInstance().destroy(); } catch (e) {
      console.warn('[Shutdown] LicenseService cleanup failed:', (e as Error).message);
    }
    try { MonitorService.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] MonitorService cleanup failed:', (e as Error).message);
    }
    try { DockerEventManager.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] DockerEventManager cleanup failed:', (e as Error).message);
    }
    try { ImageUpdateService.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] ImageUpdateService cleanup failed:', (e as Error).message);
    }
    try { SchedulerService.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] SchedulerService cleanup failed:', (e as Error).message);
    }
    try { DatabaseService.getInstance().getDb().close(); } catch (e) {
      console.warn('[Shutdown] Database close failed:', (e as Error).message);
    }
    console.log('[Shutdown] Done - exiting');
    process.exit(0);
  });

  // Force-exit after 10 s if connections refuse to drain
  setTimeout(() => {
    console.error('[Shutdown] Timed out waiting for connections - forcing exit');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
