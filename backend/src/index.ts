import express, { Request, Response } from 'express';
import { FileSystemService } from './services/FileSystemService';
import { DatabaseService } from './services/DatabaseService';
import { MonitorService } from './services/MonitorService';
import { AutoHealService } from './services/AutoHealService';
import { DockerEventManager } from './services/DockerEventManager';
import { ImageUpdateService } from './services/ImageUpdateService';
import { NodeRegistry } from './services/NodeRegistry';
import { LicenseService } from './services/LicenseService';
import { SchedulerService } from './services/SchedulerService';
import { sweepStaleTempDirs as sweepStaleGitTempDirs } from './services/GitSourceService';
import './types/express';
import {
  PORT,
  MFA_REPLAY_TTL_MS,
  MFA_REPLAY_PURGE_INTERVAL_MS,
} from './helpers/constants';
import { authGate, auditLog } from './middleware/authGate';
import { enforceApiTokenScope } from './middleware/apiTokenScope';
import { errorHandler } from './middleware/errorHandler';
import { createApp } from './app';
import { createRemoteProxyMiddleware } from './proxy/remoteNodeProxy';
import { createServer } from './server';
import { attachUpgrade } from './websocket/upgradeHandler';
import { metaRouter } from './routes/meta';
import { authRouter } from './routes/auth';
import { mfaRouter } from './routes/mfa';
import { ssoRouter } from './routes/sso';
import { licenseRouter, systemUpdateRouter } from './routes/license';
import { webhooksRouter } from './routes/webhooks';
import { usersRouter } from './routes/users';
import { gitSourcesRouter, stackGitSourceRouter } from './routes/gitSources';
import { fleetRouter } from './routes/fleet';
import { permissionsRouter } from './routes/permissions';
import { convertRouter } from './routes/convert';
import { alertsRouter } from './routes/alerts';
import { labelsRouter, stackLabelsRouter } from './routes/labels';
import { apiTokensRouter } from './routes/apiTokens';
import { auditLogRouter } from './routes/auditLog';
import { settingsRouter } from './routes/settings';
import { scheduledTasksRouter } from './routes/scheduledTasks';
import { agentsRouter } from './routes/agents';
import { metricsRouter } from './routes/metrics';
import { imageUpdatesRouter, autoUpdateRouter } from './routes/imageUpdates';
import { autoHealRouter } from './routes/autoHeal';
import { notificationsRouter, notificationRoutesRouter } from './routes/notifications';
import { consoleRouter } from './routes/console';
import { ssoConfigRouter } from './routes/ssoConfig';
import { registriesRouter } from './routes/registries';
import { systemMaintenanceRouter } from './routes/systemMaintenance';
import { templatesRouter } from './routes/templates';
import { securityRouter } from './routes/security';
import { containersRouter, portsRouter } from './routes/containers';
import { nodesRouter } from './routes/nodes';
import { stacksRouter } from './routes/stacks';

import SelfUpdateService from './services/SelfUpdateService';
import TrivyService from './services/TrivyService';
import { isDebugEnabled } from './utils/debug';

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

// Build the Express app with the canonical middleware pipeline (steps 1-9 of
// the order documented in app.ts). Steps 10-16 (authGate, auditLog,
// apiTokenScope, remote proxy, routes, static, errorHandler) are registered
// below as routes and handlers are extracted in later phases.
const app = createApp();

// FileSystemService and ComposeService are instantiated per-request via .getInstance(nodeId)

// Public /api/health and /api/meta (no auth). Mounted before authGate.
app.use('/api', metaRouter);

// Auth / MFA / SSO routers. Mounted before authGate because some paths are
// public (login, setup, SSO callbacks); handlers that need auth use the
// authMiddleware directly.
app.use('/api/auth', authRouter);
app.use('/api/auth', mfaRouter);
app.use('/api/auth/sso', ssoRouter);


// Auth gate on all /api/* routes (exempts /auth/* and webhook triggers).
app.use('/api', authGate);

// Audit-log every mutating /api/* action (POST/PUT/DELETE/PATCH).
app.use('/api', auditLog);

app.use('/api', enforceApiTokenScope);

// Phase 4A-1 route mounts. These live behind authGate + auditLog +
// apiTokenScope but ahead of any group still inlined below. As each
// remaining group gets extracted the inline block comes out and a new
// app.use slots in here.
app.use('/api/license', licenseRouter);
app.use('/api/system', systemUpdateRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/convert', convertRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/stacks', stackLabelsRouter);
app.use('/api/api-tokens', apiTokensRouter);
app.use('/api/audit-log', auditLogRouter);
app.use('/api/fleet', fleetRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/users', usersRouter);
app.use('/api/git-sources', gitSourcesRouter);
app.use('/api/stacks', stackGitSourceRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/scheduled-tasks', scheduledTasksRouter);
app.use('/api/agents', agentsRouter);
app.use('/api', metricsRouter);
app.use('/api/image-updates', imageUpdatesRouter);
app.use('/api/auto-update', autoUpdateRouter);
app.use('/api/auto-heal', autoHealRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/notification-routes', notificationRoutesRouter);
app.use('/api/system', consoleRouter);
app.use('/api/sso/config', ssoConfigRouter);
app.use('/api/registries', registriesRouter);
app.use('/api/system', systemMaintenanceRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/security', securityRouter);
app.use('/api/containers', containersRouter);
app.use('/api/ports', portsRouter);
app.use('/api/nodes', nodesRouter);
app.use('/api/stacks', stacksRouter);

// Remote Node HTTP Proxy (see proxy/remoteNodeProxy.ts). Mounted here after
// authGate + auditLog + apiTokenScope so local Sencho enforces auth first;
// the proxy then takes over for remote-targeted requests.
app.use('/api/', createRemoteProxyMiddleware());

// HTTP server + WebSocket servers (see server.ts for shape).
const { server, wss, pilotTunnelWss } = createServer(app);

// Dispatch WebSocket upgrades (see websocket/upgradeHandler.ts for the full
// dispatch order). Also wires the main wss's connection handler for
// container-exec / streamStats actions.
attachUpgrade(server, { wss, pilotTunnelWss });



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

// Central error handler: must be registered after all routes and static.
app.use(errorHandler);

// Start server with migration
let mfaReplayPurgeTimer: NodeJS.Timeout | null = null;

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
  AutoHealService.getInstance().start();

  // Start Docker Event Stream (causal crash/OOM/health detection per local node)
  await DockerEventManager.getInstance().start();

  // Detect Trivy binary so the vulnerability-scanning capability reflects
  // reality before any request hits and so the first scan does not pay
  // detection latency.
  await TrivyService.getInstance().initialize();

  // Start Background Image Update Checker
  ImageUpdateService.getInstance().start();

  // Start Scheduled Operations Service
  SchedulerService.getInstance().start();

  // Sweep any leftover git-source temp clones from a crashed prior run
  sweepStaleGitTempDirs().catch((err) => {
    console.warn('[GitSource] Temp dir sweep failed:', (err as Error).message);
  });

  // Periodic purge of used-MFA-code rows so the replay blacklist stays
  // bounded even without verification traffic. The table holds (user, code,
  // window) tuples for the last ~2 minutes; older rows are safe to drop.
  mfaReplayPurgeTimer = setInterval(() => {
    try {
      const deleted = DatabaseService.getInstance().purgeOldMfaCodes(Date.now() - MFA_REPLAY_TTL_MS);
      if (isDebugEnabled() && deleted > 0) {
        console.log('[MFA:diag] replay purge deleted=', deleted);
      }
    } catch (err) {
      console.warn('[MFA] Replay purge failed:', (err as Error).message);
    }
  }, MFA_REPLAY_PURGE_INTERVAL_MS);
  mfaReplayPurgeTimer.unref();

  // Pilot-agent mode: bind only to loopback so no external port is exposed.
  // All traffic is demultiplexed from the primary via the pilot tunnel.
  const isPilotAgent = process.env.SENCHO_MODE === 'pilot';
  const listenHost = isPilotAgent ? '127.0.0.1' : undefined;

  server.listen(PORT, listenHost, () => {
    console.log(`Server running on ${listenHost || '0.0.0.0'}:${PORT}${isPilotAgent ? ' (pilot-agent mode)' : ''}`);
    if (isPilotAgent) {
      // Start the outbound tunnel client once the local HTTP server is ready
      // to accept loopback traffic from the tunnel.
      import('./pilot/agent').then((m) => m.startPilotAgent(PORT)).catch((err) => {
        console.error('[Pilot] Agent startup failed:', err);
      });
    }
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
    try { AutoHealService.getInstance().stop(); } catch (e) { console.warn('[Shutdown] AutoHealService cleanup failed:', (e as Error).message); }
    try { DockerEventManager.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] DockerEventManager cleanup failed:', (e as Error).message);
    }
    try { ImageUpdateService.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] ImageUpdateService cleanup failed:', (e as Error).message);
    }
    try { SchedulerService.getInstance().stop(); } catch (e) {
      console.warn('[Shutdown] SchedulerService cleanup failed:', (e as Error).message);
    }
    if (mfaReplayPurgeTimer) {
      clearInterval(mfaReplayPurgeTimer);
      mfaReplayPurgeTimer = null;
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
