import express, { Request, Response } from 'express';
import './types/express';
import { authGate, auditLog } from './middleware/authGate';
import { enforceApiTokenScope } from './middleware/apiTokenScope';
import { errorHandler } from './middleware/errorHandler';
import { createApp } from './app';
import { createRemoteProxyMiddleware } from './proxy/remoteNodeProxy';
import { createServer } from './server';
import { attachUpgrade } from './websocket/upgradeHandler';
import { startServer } from './bootstrap/startup';
import { installShutdownHandlers } from './bootstrap/shutdown';
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

const app = createApp();

// Public /api/health and /api/meta (no auth). Mounted before authGate.
app.use('/api', metaRouter);

// Auth / MFA / SSO routers. Mounted before authGate because some paths are
// public (login, setup, SSO callbacks); handlers that need auth use
// authMiddleware directly.
app.use('/api/auth', authRouter);
app.use('/api/auth', mfaRouter);
app.use('/api/auth/sso', ssoRouter);

// Auth gate on all /api/* routes (exempts /auth/* and webhook triggers).
app.use('/api', authGate);

// Audit-log every mutating /api/* action (POST/PUT/DELETE/PATCH).
app.use('/api', auditLog);

app.use('/api', enforceApiTokenScope);

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

const { server, wss, pilotTunnelWss } = createServer(app);
attachUpgrade(server, { wss, pilotTunnelWss });

// Static / SPA fallback. Production serves the built frontend; dev returns a
// JSON 404 for unmatched /api paths to prevent fetch hangs.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));
  app.use((req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile('index.html', { root: 'public' });
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
} else {
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
}

// Central error handler: must be registered after all routes and static.
app.use(errorHandler);

installShutdownHandlers(server);

if (require.main === module) {
  void startServer(server);
}

// Exports used by tests (supertest requires the http.Server instance).
export { app, server };
