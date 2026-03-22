import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import WebSocket, { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import DockerController, { globalDockerNetwork } from './services/DockerController';
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
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { HostTerminalService } from './services/HostTerminalService';
import { DatabaseService } from './services/DatabaseService';
import { NotificationService } from './services/NotificationService';
import { MonitorService } from './services/MonitorService';
import { ImageUpdateService } from './services/ImageUpdateService';
import { templateService } from './services/TemplateService';
import { ErrorParser } from './utils/ErrorParser';
import { NodeRegistry } from './services/NodeRegistry';
import { isValidStackName, isValidRemoteUrl } from './utils/validation';
import YAML from 'yaml';
import fs, { promises as fsPromises } from 'fs';

const execAsync = promisify(exec);

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

// Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
// crossOriginEmbedderPolicy is disabled because the Monaco editor uses workers
// that don't set the required COEP headers.
app.use(helmet({ crossOriginEmbedderPolicy: false }));

// CORS — in production restrict to the configured frontend origin.
// In development, mirror the request origin so Vite's dev server works.
const corsOrigin = process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL
  : true;

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
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
      !req.path.startsWith('/api/nodes')
    ) {
      // Preserve body stream for proxy piping
      next();
      return;
    }
  }
  express.json()(req, res, next);
});
app.use(cookieParser());

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
    !req.path.startsWith('/api/nodes')
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
      user?: { username: string };
      nodeId: number;
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
    const decoded = jwt.verify(token, jwtSecret) as { username?: string; scope?: string };
    // Accept both user sessions and node proxy tokens
    req.user = { username: decoded.username || 'node-proxy' };
    next();
  } catch (err) {
    console.error('[Auth] Token validation failed:', (err as Error).message);
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
};

// Rate limiter for auth endpoints — prevents brute-force attacks.
// 5 attempts per 15-minute window per IP. Applies to login and setup only;
// password-change is already protected by authMiddleware + old-password verification.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

// Public health endpoint - no auth required (used by Docker HEALTHCHECK and uptime monitors)
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', uptime: process.uptime() });
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

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
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

    // Issue JWT and log user in
    const token = jwt.sign({ username }, jwtSecret, { expiresIn: '24h' });
    res.cookie(COOKIE_NAME, token, getCookieOptions(req));
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
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const storedUsername = settings.auth_username;
    const storedHash = settings.auth_password_hash;

    if (storedUsername && storedHash && username === storedUsername) {
      const isValid = await bcrypt.compare(password, storedHash);
      if (isValid) {
        const jwtSecret = settings.auth_jwt_secret;
        if (!jwtSecret) throw new Error('JWT secret missing from DB');
        const token = jwt.sign({ username }, jwtSecret, { expiresIn: '24h' });
        res.cookie(COOKIE_NAME, token, getCookieOptions(req));
        res.json({ success: true, message: 'Login successful' });
        return;
      }
    }

    res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Update password endpoint
app.put('/api/auth/password', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Old password and new password are required' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    const dbSvc = DatabaseService.getInstance();
    const settings = dbSvc.getGlobalSettings();
    const storedHash = settings.auth_password_hash;

    if (!storedHash) {
      res.status(400).json({ error: 'Auth not configured properly' });
      return;
    }

    const isValid = await bcrypt.compare(oldPassword, storedHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid old password' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    dbSvc.updateGlobalSetting('auth_password_hash', newHash);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password update error:', error);
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
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) {
      res.status(500).json({ error: 'No JWT secret configured on this instance.' });
      return;
    }
    // No expiry - this token is managed by the admin who pastes it into the main dashboard
    const token = jwt.sign({ scope: 'node_proxy' }, jwtSecret);
    res.json({ token });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to generate node token' });
  }
});

// Apply authentication middleware to all /api/* routes except /api/auth/*
app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/auth/')) {
    next();
    return;
  }
  authMiddleware(req, res, next);
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
  if (req.path.startsWith('/auth/') || req.path.startsWith('/nodes')) {
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
    const decoded = jwt.verify(token, jwtSecret) as { username?: string; scope?: string };

    // Node proxy tokens are machine-to-machine credentials and must never be granted
    // interactive terminal access (host console or container exec).
    const isProxyToken = decoded.scope === 'node_proxy';

    const url = req.url || '';
    const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

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
          const tokenRes = await fetch(`${node.api_url.replace(/\/$/, '')}/api/system/console-token`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${node.api_token}` },
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
        try {
          ComposeService.getInstance(nodeId).streamLogs(stackName, ws);
        } catch (error) {
          console.error('Failed to stream logs:', error);
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
      const hostConsoleWss = new WebSocketServer({ noServer: true });
      hostConsoleWss.handleUpgrade(req, socket, head, (ws) => {
        hostConsoleWss.close();
        let targetDirectory = '';
        try {
          const baseDir = FileSystemService.getInstance(nodeId).getBaseDir();
          const stackParam = parsedUrl.searchParams.get('stack');
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
          HostTerminalService.spawnTerminal(ws, targetDirectory);
        } catch (error) {
          console.error('Failed to spawn host terminal:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(`Error spawning terminal: ${(error as Error).message}\r\n`);
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

// Stack Routes - Updated to use stackName (directory name) instead of filename

app.get('/api/stacks', async (req: Request, res: Response) => {
  try {
    const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    res.json(stacks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stacks' });
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
  try {
    const stackName = req.params.stackName as string;
    if (stackName.includes('..') || stackName.includes('/') || stackName.includes('\\')) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const { content } = req.body;
    console.log('PUT /api/stacks/:stackName', { stackName, contentType: typeof content, contentLength: content?.length });
    if (typeof content !== 'string') {
      console.error('Content is not a string:', content);
      return res.status(400).json({ error: 'Content must be a string' });
    }
    await FileSystemService.getInstance(req.nodeId).saveStackContent(stackName, content);
    console.log('Stack saved successfully:', stackName);
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
        // Reject paths that escape the stack directory
        if (!resolved.startsWith(path.resolve(stackDir) + path.sep) && resolved !== path.resolve(stackDir)) {
          console.warn(`[Security] env_file path "${rawPath}" escapes stack directory — skipping`);
          return;
        }
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
      return [defaultEnvPath];
    }

    return Array.from(envFiles);
  } catch (error) {
    console.warn(`Could not parse compose.yaml for env_file resolution in stack "${stackName}":`, error);
  }

  return [defaultEnvPath];
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
    } catch {
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
  try {
    const stackName = req.params.stackName as string;
    if (stackName.includes('..') || stackName.includes('/') || stackName.includes('\\')) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
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
    res.json({ message: 'Env file saved successfully' });
  } catch (error) {
    console.error('Failed to save env file:', error);
    res.status(500).json({ error: 'Failed to save env file' });
  }
});

app.post('/api/stacks', async (req: Request, res: Response) => {
  try {
    const { stackName } = req.body;
    if (!stackName || typeof stackName !== 'string') {
      return res.status(400).json({ error: 'Stack name is required and must be a string' });
    }
    if (!/^[a-zA-Z0-9-]+$/.test(stackName)) {
      return res.status(400).json({ error: 'Stack name can only contain alphanumeric characters and hyphens' });
    }
    await FileSystemService.getInstance(req.nodeId).createStack(stackName);
    res.json({ message: 'Stack created successfully', name: stackName });
  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      return res.status(409).json({ error: 'Stack already exists' });
    }
    console.error('Failed to create stack:', error);
    res.status(500).json({ error: 'Failed to create stack' });
  }
});

app.delete('/api/stacks/:name', async (req: Request, res: Response) => {
  const stackName = req.params.name as string;
  try {
    // Stage 1: Tell Docker to clean up ghost networks/containers
    try {
      await ComposeService.getInstance(req.nodeId).downStack(stackName);
    } catch (downErr) {
      console.warn(`[Teardown] Docker down failed or nothing to clean up for ${stackName}`);
    }

    // Stage 2: Obliterate the files
    await FileSystemService.getInstance(req.nodeId).deleteStack(stackName);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete stack' });
  }
});

app.get('/api/stacks/:stackName/containers', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);
    res.json(containers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch containers' });
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
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.startContainer(id);
    res.json({ message: 'Container started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start container' });
  }
});

app.post('/api/containers/:id/stop', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.stopContainer(id);
    res.json({ message: 'Container stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop container' });
  }
});

app.post('/api/containers/:id/restart', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.restartContainer(id);
    res.json({ message: 'Container restarted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart container' });
  }
});

// End of legacy container routes
app.post('/api/stacks/:stackName/deploy', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    await ComposeService.getInstance(req.nodeId).deployStack(stackName, terminalWs || undefined);
    res.json({ message: 'Deployed successfully' });
  } catch (error: any) {
    console.error('Failed to deploy stack:', error);
    res.status(500).json({ error: error.message || 'Failed to deploy stack' });
  }
});

app.post('/api/stacks/:stackName/down', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    await ComposeService.getInstance(req.nodeId).runCommand(stackName, 'down', terminalWs || undefined);
    res.json({ status: 'Command started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start command' });
  }
});

app.post('/api/stacks/:stackName/restart', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.restartContainer(c.Id)));
    res.json({ success: true, message: 'Restart completed via Engine API.' });
  } catch (error: any) {
    console.error('Failed to restart containers:', error);
    res.status(500).json({ error: error.message || 'Failed to restart containers' });
  }
});

app.post('/api/stacks/:stackName/stop', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.stopContainer(c.Id)));
    res.json({ success: true, message: 'Stop completed via Engine API.' });
  } catch (error: any) {
    console.error('Failed to stop containers:', error);
    res.status(500).json({ error: error.message || 'Failed to stop containers' });
  }
});

app.post('/api/stacks/:stackName/start', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.startContainer(c.Id)));
    res.json({ success: true, message: 'Start completed via Engine API.' });
  } catch (error: any) {
    console.error('Failed to start containers:', error);
    res.status(500).json({ error: error.message || 'Failed to start containers' });
  }
});

// Update stack: pull images and recreate containers
app.post('/api/stacks/:stackName/update', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    // Await update completion
    await ComposeService.getInstance(req.nodeId).updateStack(stackName, terminalWs || undefined);
    res.json({ status: 'Update completed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update' });
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

// Get all containers stats for dashboard
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getRunningContainers();
    const allContainers = await dockerController.getAllContainers();

    const active = containers.length;
    const exited = allContainers.filter((c: { State: string }) => c.State === 'exited').length;
    const total = allContainers.length;

    res.json({ active, exited, total, inactive: total - active - exited });
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
    const dockerController = DockerController.getInstance(req.nodeId);
    const containers = await dockerController.getRunningContainers();
    const allLogs: any[] = [];

    await Promise.all(containers.map(async (c) => {
      const stackName = c.Labels?.['com.docker.compose.project'] || 'system';
      let rawName = c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12);

      // Standardize naming: Strip stack name prefix if it exists
      let containerName = rawName;
      if (rawName.startsWith(`${stackName}-`)) {
        containerName = rawName.replace(`${stackName}-`, '').replace(/-1$/, '');
      } else if (rawName.startsWith(`${stackName}_`)) {
        containerName = rawName.replace(`${stackName}_`, '').replace(/_1$/, '');
      }

      try {
        const container = dockerController.getDocker().getContainer(c.Id);
        const inspect = await container.inspect();
        const isTty = inspect.Config.Tty;
        const logsBuffer = await container.logs({ stdout: true, stderr: true, tail: 100, timestamps: true }) as Buffer;

        const parseAndPushLog = (line: string, source: string) => {
          if (!line.trim()) return;
          const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)/);
          let cleanMessage = line;
          let timestampMs = Date.now();

          if (timeMatch) {
            timestampMs = new Date(timeMatch[1]).getTime();
            cleanMessage = timeMatch[2];
          }

          // Default to INFO, or ERROR if coming from STDERR.
          let level = source === 'STDERR' ? 'ERROR' : 'INFO';

          // 1. Explicitly check for INFO/DEBUG indicators (Overrides STDERR defaults)
          if (/level=["']?(info|debug|trace)["']?/i.test(cleanMessage) ||
            /\[\s*(info|inf|debug|dbg|trace)\s*\]/i.test(cleanMessage) ||
            /(?:\s|^)(info|inf|debug|trace)(?:\s|:|\(|\[|$)/i.test(cleanMessage)) {
            level = 'INFO';
          }
          // 2. Check for WARN indicators
          else if (/level=["']?(warn|warning)["']?/i.test(cleanMessage) ||
            /\[\s*(warn|warning)\s*\]/i.test(cleanMessage) ||
            /(?:\s|^)(warn|warning)(?:\s|:|\(|\[|$)/i.test(cleanMessage)) {
            level = 'WARN';
          }
          // 3. Check for ERROR indicators
          else if (/level=["']?(error|err|fatal|crit|critical|panic)["']?/i.test(cleanMessage) ||
            /\[\s*(error|err|fatal|crit|critical|panic)\s*\]/i.test(cleanMessage) ||
            /(?:\s|^)(error|err|fatal|crit|critical|panic)(?:\s|:|\(|\[|$)/i.test(cleanMessage) ||
            /Exception:/i.test(cleanMessage)) {
            level = 'ERROR';
          }

          allLogs.push({ stackName, containerName, source, level, message: cleanMessage, timestampMs });
        };

        if (isTty) {
          // No multiplex headers. Just split by newline.
          const payload = logsBuffer.toString('utf-8').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
          payload.split('\n').forEach(line => parseAndPushLog(line, 'STDOUT'));
        } else {
          // Parse 8-byte Docker multiplex header
          let offset = 0;
          while (offset < logsBuffer.length) {
            const streamType = logsBuffer[offset];
            const length = logsBuffer.readUInt32BE(offset + 4);
            offset += 8;
            if (offset + length > logsBuffer.length) break;

            const payload = logsBuffer.slice(offset, offset + length).toString('utf-8');
            offset += length;
            payload.split('\n').forEach(line => parseAndPushLog(line, streamType === 2 ? 'STDERR' : 'STDOUT'));
          }
        }
      } catch (err) {
        console.warn(`[GlobalLogs] Failed to fetch/parse logs for container ${containerName} (${c.Id.substring(0, 12)}):`, (err as Error).message);
      }
    }));

    // Sort globally by timestamp ascending (newest bottom).
    // Limit to 500 lines - the client renders at most 300 rows at once, so
    // sending 2000 lines was wasting bandwidth and inflating JSON parse time.
    allLogs.sort((a, b) => a.timestampMs - b.timestampMs);
    res.json(allLogs.slice(-500));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch global logs' });
  }
});

app.get('/api/logs/global/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const dockerController = DockerController.getInstance(req.nodeId);
  const streams: NodeJS.ReadableStream[] = [];

  try {
    const containers = await dockerController.getRunningContainers();

    await Promise.all(containers.map(async (c) => {
      const stackName = c.Labels?.['com.docker.compose.project'] || 'system';
      let rawName = c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12);
      let containerName = rawName;
      if (rawName.startsWith(`${stackName}-`)) containerName = rawName.replace(`${stackName}-`, '').replace(/-1$/, '');
      else if (rawName.startsWith(`${stackName}_`)) containerName = rawName.replace(`${stackName}_`, '').replace(/_1$/, '');

      try {
        const container = dockerController.getDocker().getContainer(c.Id);
        const inspect = await container.inspect();
        const isTty = inspect.Config.Tty;

        // Dev mode gets a larger tail
        const stream = await container.logs({ follow: true, stdout: true, stderr: true, tail: 500, timestamps: true });
        streams.push(stream);

        const processLine = (line: string, source: string) => {
          if (!line.trim()) return;
          const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)/);
          let cleanMessage = line;
          let timestampMs = Date.now();

          if (timeMatch) {
            timestampMs = new Date(timeMatch[1]).getTime();
            cleanMessage = timeMatch[2];
          }

          // Default to INFO, or ERROR if coming from STDERR.
          let level = source === 'STDERR' ? 'ERROR' : 'INFO';

          // 1. Explicitly check for INFO/DEBUG indicators (Overrides STDERR defaults)
          if (/level=["']?(info|debug|trace)["']?/i.test(cleanMessage) ||
            /\[\s*(info|inf|debug|dbg|trace)\s*\]/i.test(cleanMessage) ||
            /(?:\s|^)(info|inf|debug|trace)(?:\s|:|\(|\[|$)/i.test(cleanMessage)) {
            level = 'INFO';
          }
          // 2. Check for WARN indicators
          else if (/level=["']?(warn|warning)["']?/i.test(cleanMessage) ||
            /\[\s*(warn|warning)\s*\]/i.test(cleanMessage) ||
            /(?:\s|^)(warn|warning)(?:\s|:|\(|\[|$)/i.test(cleanMessage)) {
            level = 'WARN';
          }
          // 3. Check for ERROR indicators
          else if (/level=["']?(error|err|fatal|crit|critical|panic)["']?/i.test(cleanMessage) ||
            /\[\s*(error|err|fatal|crit|critical|panic)\s*\]/i.test(cleanMessage) ||
            /(?:\s|^)(error|err|fatal|crit|critical|panic)(?:\s|:|\(|\[|$)/i.test(cleanMessage) ||
            /Exception:/i.test(cleanMessage)) {
            level = 'ERROR';
          }

          res.write(`data: ${JSON.stringify({ stackName, containerName, source, level, message: cleanMessage, timestampMs })}\n\n`);
        };

        stream.on('data', (chunk: Buffer) => {
          if (isTty) {
            const payload = chunk.toString('utf-8').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
            payload.split('\n').forEach(line => processLine(line, 'STDOUT'));
          } else {
            let offset = 0;
            while (offset < chunk.length) {
              if (offset + 8 > chunk.length) break;
              const streamType = chunk[offset];
              const length = chunk.readUInt32BE(offset + 4);
              offset += 8;
              if (offset + length > chunk.length) break;

              const payload = chunk.slice(offset, offset + length).toString('utf-8');
              offset += length;
              payload.split('\n').forEach(line => processLine(line, streamType === 2 ? 'STDERR' : 'STDOUT'));
            }
          }
        });
      } catch (err) { /* ignore */ }
    }));

    // Cleanup when client closes the tab or switches views
    req.on('close', () => {
      streams.forEach(s => {
        try { (s as any).destroy(); } catch (e) { }
      });
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({ level: 'ERROR', message: '[Sencho] Failed to attach global log stream.', timestampMs: Date.now(), stackName: 'system', containerName: 'backend', source: 'STDERR' })}\n\n`);
    res.end();
  }
});

// Get host system stats
app.get('/api/system/stats', async (req: Request, res: Response) => {
  try {
    const rxSec = Math.max(0, globalDockerNetwork.rxSec);
    const txSec = Math.max(0, globalDockerNetwork.txSec);

    // Remote node requests are intercepted and proxied by remoteNodeProxy before reaching here.
    // This handler only runs for local nodes.
    const [currentLoad, mem, fsSize] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize()
    ]);

    const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:') || fsSize[0];

    res.json({
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
      network: { rxBytes: 0, txBytes: 0, rxSec, txSec },
    });
  } catch (error) {
    console.error('Failed to fetch system stats:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// --- Notification & Alerting Routes ---

app.get('/api/agents', async (req: Request, res: Response) => {
  try {
    const agents = DatabaseService.getInstance().getAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

app.post('/api/agents', async (req: Request, res: Response) => {
  try {
    const agent = req.body;
    DatabaseService.getInstance().upsertAgent(agent);
    res.json({ success: true });
  } catch (error) {
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
]);

// Zod schema for bulk PATCH - all keys optional, present keys fully validated
import { z } from 'zod';
const SettingsPatchSchema = z.object({
  host_cpu_limit:          z.coerce.number().int().min(1).max(100).transform(String),
  host_ram_limit:          z.coerce.number().int().min(1).max(100).transform(String),
  host_disk_limit:         z.coerce.number().int().min(1).max(100).transform(String),
  docker_janitor_gb:       z.coerce.number().min(0).transform(String),
  global_crash:            z.enum(['0', '1']),
  global_logs_refresh:     z.enum(['1', '3', '5', '10']),
  developer_mode:          z.enum(['0', '1']),
  template_registry_url:   z.string().max(2048).refine(v => v === '' || /^https?:\/\/.+/.test(v), { message: 'Must be a valid URL or empty' }),
  metrics_retention_hours: z.coerce.number().int().min(1).max(8760).transform(String),
  log_retention_days:      z.coerce.number().int().min(1).max(365).transform(String),
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

app.get('/api/alerts', async (req: Request, res: Response) => {
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

app.post('/api/alerts', async (req: Request, res: Response) => {
  const parsed = AlertCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid alert data', details: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    DatabaseService.getInstance().addStackAlert(parsed.data);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to add alert:', error);
    res.status(500).json({ error: 'Failed to add alert' });
  }
});

app.delete('/api/alerts/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    DatabaseService.getInstance().deleteStackAlert(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

app.get('/api/notifications', async (req: Request, res: Response) => {
  try {
    const history = DatabaseService.getInstance().getNotificationHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/read', async (req: Request, res: Response) => {
  try {
    DatabaseService.getInstance().markAllNotificationsRead();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

app.delete('/api/notifications/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    DatabaseService.getInstance().deleteNotification(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.delete('/api/notifications', async (req: Request, res: Response) => {
  try {
    DatabaseService.getInstance().deleteAllNotifications();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

app.post('/api/notifications/test', async (req: Request, res: Response) => {
  try {
    const { type, url } = req.body;
    await NotificationService.getInstance().testDispatch(type, url);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Test failed', details: error.message });
  }
});

// Issue a short-lived console session token for WebSocket proxy delegation.
// When the gateway needs to proxy an interactive terminal (host console or container exec)
// to a remote node, it calls this endpoint (authenticated with the long-lived api_token)
// to receive a short-lived token. The remote's WS upgrade handler allows 'console_session'
// tokens through its isProxyToken guard, keeping the long-lived api_token off interactive paths.
app.post('/api/system/console-token', authMiddleware, (req: Request, res: Response): void => {
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
  try {
    const { containerIds } = req.body;
    if (!Array.isArray(containerIds)) {
      return res.status(400).json({ error: 'containerIds must be an array' });
    }
    const dockerController = DockerController.getInstance(req.nodeId);
    const results = await dockerController.removeContainers(containerIds);
    res.json({ results });
  } catch (error) {
    console.error('Failed to prune orphan containers:', error);
    res.status(500).json({ error: 'Failed to prune orphan containers' });
  }
});

app.post('/api/system/prune/system', async (req: Request, res: Response) => {
  try {
    const { target } = req.body; // 'containers', 'images', 'networks', 'volumes'
    if (!['containers', 'images', 'networks', 'volumes'].includes(target)) {
      return res.status(400).json({ error: 'Invalid prune target' });
    }

    const dockerController = DockerController.getInstance(req.nodeId);
    const result = await dockerController.pruneSystem(target);

    res.json({ message: 'Prune completed', ...result });
  } catch (error: any) {
    console.error('System prune error:', error);
    res.status(500).json({ error: 'System prune failed', details: error.message });
  }
});

app.get('/api/system/docker-df', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const df = await dockerController.getDiskUsage();
    res.json(df);
  } catch (error) {
    console.error('Failed to fetch docker disk usage:', error);
    res.status(500).json({ error: 'Failed to fetch docker disk usage' });
  }
});

app.get('/api/system/images', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const images = await dockerController.getImages();
    res.json(images);
  } catch (error) {
    console.error('Failed to fetch images:', error);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

app.get('/api/system/volumes', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const volumes = await dockerController.getVolumes();
    res.json(volumes);
  } catch (error) {
    console.error('Failed to fetch volumes:', error);
    res.status(500).json({ error: 'Failed to fetch volumes' });
  }
});

app.get('/api/system/networks', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const networks = await dockerController.getNetworks();
    res.json(networks);
  } catch (error) {
    console.error('Failed to fetch networks:', error);
    res.status(500).json({ error: 'Failed to fetch networks' });
  }
});

app.post('/api/system/images/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.removeImage(id);
    res.json({ success: true, message: 'Image deleted' });
  } catch (error: any) {
    console.error('Failed to delete image:', error);
    res.status(500).json({ error: error.message || 'Failed to delete image' });
  }
});

app.post('/api/system/volumes/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.removeVolume(id);
    res.json({ success: true, message: 'Volume deleted' });
  } catch (error: any) {
    console.error('Failed to delete volume:', error);
    res.status(500).json({ error: error.message || 'Failed to delete volume' });
  }
});

app.post('/api/system/networks/delete', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    const dockerController = DockerController.getInstance(req.nodeId);
    await dockerController.removeNetwork(id);
    res.json({ success: true, message: 'Network deleted' });
  } catch (error: any) {
    console.error('Failed to delete network:', error);
    res.status(500).json({ error: error.message || 'Failed to delete network' });
  }
});

// --- App Templates Routes ---

app.get('/api/templates', async (req: Request, res: Response) => {
  try {
    const templates = await templateService.getTemplates();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

app.post('/api/templates/refresh-cache', authMiddleware, (req: Request, res: Response) => {
  templateService.clearCache();
  res.json({ success: true });
});

app.post('/api/templates/deploy', async (req: Request, res: Response) => {
  try {
    const { stackName, template, envVars } = req.body;

    if (!stackName || !template) {
      return res.status(400).json({ error: 'stackName and template are required' });
    }

    const stackPath = path.join(FileSystemService.getInstance(req.nodeId).getBaseDir(), stackName);
    if (fs.existsSync(stackPath)) {
      return res.status(409).json({
        error: `A stack directory named '${stackName}' already exists. Please choose a different Stack Name.`,
        rolledBack: false
      });
    }

    // 1. Create stack directory
    await FileSystemService.getInstance(req.nodeId).createStack(stackName);

    // 2. Generate compose YAML and save
    const composeYaml = templateService.generateComposeFromTemplate(template);
    await FileSystemService.getInstance(req.nodeId).saveStackContent(stackName, composeYaml);

    // 3. Generate env string and save to default .env
    if (envVars) {
      const envString = templateService.generateEnvString(envVars);
      const stackDir = path.join(FileSystemService.getInstance(req.nodeId).getBaseDir(), stackName);
      const defaultEnvPath = path.join(stackDir, '.env');
      await fsPromises.writeFile(defaultEnvPath, envString, 'utf-8');
    }

    // 4. Deploy the stack with atomic rollback
    try {
      await ComposeService.getInstance(req.nodeId).deployStack(stackName, terminalWs || undefined);
      res.json({ success: true, message: 'Template deployed successfully' });
    } catch (deployError: any) {
      const rawError = deployError.message || String(deployError);
      const parsed = ErrorParser.parse(rawError);

      const shouldRollback = parsed.rule ? parsed.rule.canSilentlyRollback : true;

      if (shouldRollback) {
        try {
          // Stage 1: Tell Docker to clean up ghost networks/containers
          await ComposeService.getInstance(req.nodeId).downStack(stackName);
        } catch (downErr) {
          console.error("Rollback Stage 1 (Docker down) failed:", downErr);
        }

        try {
          // Stage 2: Obliterate the files
          await FileSystemService.getInstance(req.nodeId).deleteStack(stackName);
        } catch (fsErr) {
          console.error("Rollback Stage 2 (File deletion) failed:", fsErr);
        }
      }

      res.status(500).json({
        error: parsed.message,
        rolledBack: shouldRollback,
        ruleId: parsed.rule?.id || 'UNKNOWN'
      });
    }
  } catch (error: any) {
    console.error('Failed to deploy template:', error);
    res.status(500).json({ error: error.message || 'Failed to deploy template' });
  }
});

// =========================
// Image Update Checker API
// =========================

app.get('/api/image-updates', authMiddleware, (_req: Request, res: Response) => {
    try {
        const updates = DatabaseService.getInstance().getStackUpdateStatus();
        res.json(updates);
    } catch (error) {
        console.error('Failed to fetch image update status:', error);
        res.status(500).json({ error: 'Failed to fetch image update status' });
    }
});

app.post('/api/image-updates/refresh', authMiddleware, (_req: Request, res: Response) => {
    try {
        const triggered = ImageUpdateService.getInstance().triggerManualRefresh();
        if (!triggered) {
            res.status(429).json({ error: 'Rate limited. Please wait at least 10 minutes between manual refreshes.' });
            return;
        }
        res.json({ success: true, message: 'Image update check started in background.' });
    } catch (error) {
        console.error('Failed to trigger image update refresh:', error);
        res.status(500).json({ error: 'Failed to trigger refresh' });
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

    res.json({ success: true, id });
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
  try {
    const id = parseInt(req.params.id as string);
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

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to update node:', error);
    res.status(500).json({ error: error.message || 'Failed to update node' });
  }
});

// Delete a node
app.delete('/api/nodes/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    DatabaseService.getInstance().deleteNode(id);
    NodeRegistry.getInstance().evictConnection(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete node:', error);
    res.status(500).json({ error: error.message || 'Failed to delete node' });
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

  // Start Background Watchdog
  MonitorService.getInstance().start();

  // Start Background Image Update Checker
  ImageUpdateService.getInstance().start();

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

// Graceful shutdown — allows in-flight requests to finish, then cleanly stops
// background services and closes the SQLite connection before the process exits.
// Docker sends SIGTERM when the container stops; Ctrl-C sends SIGINT in dev.
const gracefulShutdown = (signal: string) => {
  console.log(`[Shutdown] ${signal} received — shutting down gracefully…`);

  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
    try { MonitorService.getInstance().stop(); } catch { /* already stopped */ }
    try { ImageUpdateService.getInstance().stop(); } catch { /* already stopped */ }
    try { DatabaseService.getInstance().getDb().close(); } catch { /* already closed */ }
    console.log('[Shutdown] Done — exiting');
    process.exit(0);
  });

  // Force-exit after 10 s if connections refuse to drain
  setTimeout(() => {
    console.error('[Shutdown] Timed out waiting for connections — forcing exit');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
