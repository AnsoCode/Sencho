import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import DockerController from './services/DockerController';
import { FileSystemService } from './services/FileSystemService';
import { ComposeService } from './services/ComposeService';
import crypto from 'crypto';
import path from 'path';
import { DatabaseService } from './services/DatabaseService';
import { MonitorService } from './services/MonitorService';
import { AutoHealService } from './services/AutoHealService';
import { DockerEventManager } from './services/DockerEventManager';
import { ImageUpdateService } from './services/ImageUpdateService';
import { UpdatePreviewService } from './services/UpdatePreviewService';
import { NodeRegistry } from './services/NodeRegistry';
import { PilotTunnelManager } from './services/PilotTunnelManager';
import { PilotCloseCode } from './pilot/protocol';
import { LicenseService } from './services/LicenseService';
import { SchedulerService } from './services/SchedulerService';
import { CacheService } from './services/CacheService';
import { CAPABILITIES, getSenchoVersion, fetchRemoteMeta, type RemoteMeta } from './services/CapabilityRegistry';
import { GitSourceService, GitSourceError, sweepStaleTempDirs as sweepStaleGitTempDirs, repoHost as gitRepoHost } from './services/GitSourceService';
import { sendGitSourceError } from './utils/gitSourceHttp';
import './types/express';
import {
  PORT,
  MFA_REPLAY_TTL_MS,
  MFA_REPLAY_PURGE_INTERVAL_MS,
  STACK_STATUSES_CACHE_TTL_MS,
} from './helpers/constants';
import { requirePermission } from './middleware/permissions';
import {
  requirePaid,
  requireAdmin,
} from './middleware/tierGates';
import {
  buildPolicyGateOptions,
  runPolicyGate,
  triggerPostDeployScan,
} from './helpers/policyGate';
import { authGate, auditLog } from './middleware/authGate';
import { enforceApiTokenScope } from './middleware/apiTokenScope';
import { errorHandler } from './middleware/errorHandler';
import { createApp } from './app';
import { authMiddleware } from './middleware/auth';
import { createRemoteProxyMiddleware } from './proxy/remoteNodeProxy';
import { createServer } from './server';
import { attachUpgrade } from './websocket/upgradeHandler';
import { getTerminalWs } from './websocket/generic';
import { FleetUpdateTrackerService } from './services/FleetUpdateTrackerService';
import { invalidateNodeCaches } from './helpers/cacheInvalidation';
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

import { isDebugEnabled } from './utils/debug';
import { getErrorMessage } from './utils/errors';
import SelfUpdateService from './services/SelfUpdateService';
import TrivyService from './services/TrivyService';
import { enforcePolicyPreDeploy } from './services/PolicyEnforcement';
import { isValidStackName, isValidRemoteUrl, isPathWithinBase } from './utils/validation';
import YAML from 'yaml';

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

// Symbol still consumed by inline node routes still living in index.ts.
// Will move with the node route group in a later slice.
const updateTracker = FleetUpdateTrackerService.getInstance();

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
        const data: Record<string, { status: 'running' | 'exited' | 'unknown'; mainPort?: number; runningSince?: number }> = {};
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
  const fromGitStartedAt = Date.now();
  const fromGitDiag = isDebugEnabled();
  let fromGitStackName = '';
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
    fromGitStackName = typeof stack_name === 'string' ? stack_name : '';

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

    if (fromGitDiag) {
      console.log(
        `[Stacks:diag] from-git start stack=${stack_name} nodeId=${req.nodeId ?? 'local'} host=${gitRepoHost(repo_url)} branch=${branch} composePath=${compose_path} envPath=${resolvedEnvPath ?? 'none'} authType=${resolvedAuthType} autoApplyOnWebhook=${Boolean(auto_apply_on_webhook)} autoDeployOnApply=${Boolean(auto_deploy_on_apply)} deployNow=${deploy_now === true}`
      );
    }

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
      const gate = await enforcePolicyPreDeploy(
        stack_name,
        req.nodeId,
        buildPolicyGateOptions(req),
      );
      if (!gate.ok) {
        deployError = `Policy "${gate.policy?.name}" blocked deploy: ${gate.violations.length} image(s) exceed ${gate.policy?.max_severity}`;
      } else {
        try {
          await ComposeService.getInstance(req.nodeId).deployStack(stack_name);
          deployed = true;
          invalidateNodeCaches(req.nodeId);
        } catch (e) {
          deployError = getErrorMessage(e, 'Deploy failed');
          console.error(`[Stacks] Deploy after create-from-git failed for ${stack_name}:`, deployError);
        }
      }
    }

    console.log(`[Stacks] Stack created from Git: ${stack_name} at ${result.commitSha.slice(0, 7)}`);
    if (fromGitDiag) {
      console.log(
        `[Stacks:diag] from-git ok stack=${stack_name} sha=${result.commitSha.slice(0, 7)} deployed=${deployed} envWritten=${result.envWritten} warnings=${result.warnings.length} elapsedMs=${Date.now() - fromGitStartedAt}`
      );
    }
    res.json({
      name: stack_name,
      source: result.source,
      commitSha: result.commitSha,
      envWritten: result.envWritten,
      warnings: result.warnings,
      deployed,
      deployError,
    });
    if (deployed) {
      triggerPostDeployScan(stack_name, req.nodeId).catch(err =>
        console.error(`[Security] Post-deploy scan failed for ${stack_name}:`, err),
      );
    }
  } catch (error) {
    if (fromGitDiag) {
      const code = error instanceof GitSourceError ? error.code : 'UNKNOWN';
      console.log(
        `[Stacks:diag] from-git fail stack=${fromGitStackName} code=${code} elapsedMs=${Date.now() - fromGitStartedAt}`
      );
    }
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
    if (!(await runPolicyGate(req, res, stackName, req.nodeId))) return;
    const debug = isDebugEnabled();
    const atomic = LicenseService.getInstance().getTier() === 'paid';
    if (debug) console.debug('[Stacks:debug] Deploy starting', { stackName, atomic, nodeId: req.nodeId });
    const t0 = Date.now();
    await ComposeService.getInstance(req.nodeId).deployStack(stackName, getTerminalWs(), atomic);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Deploy completed: ${stackName}`);
    if (debug) console.debug(`[Stacks:debug] Deploy finished in ${Date.now() - t0}ms`);
    res.json({ message: 'Deployed successfully' });
    triggerPostDeployScan(stackName, req.nodeId).catch(err =>
      console.error(`[Security] Post-deploy scan failed for ${stackName}:`, err),
    );
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
    await ComposeService.getInstance(req.nodeId).runCommand(stackName, 'down', getTerminalWs());
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

// Update preview: semver diff, risk tagging, rollback target for the readiness board
app.get('/api/stacks/:stackName/update-preview', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    const preview = await UpdatePreviewService.getInstance().getPreview(req.nodeId, stackName);
    res.json(preview);
  } catch (error) {
    console.error(`[Stacks] Update preview failed: ${stackName}`, error);
    res.status(500).json({ error: 'Failed to compute update preview' });
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
    if (!(await runPolicyGate(req, res, stackName, req.nodeId))) return;
    const debug = isDebugEnabled();
    const atomic = LicenseService.getInstance().getTier() === 'paid';
    if (debug) console.debug('[Stacks:debug] Update starting', { stackName, atomic, nodeId: req.nodeId });
    const t0 = Date.now();
    await ComposeService.getInstance(req.nodeId).updateStack(stackName, getTerminalWs(), atomic);
    DatabaseService.getInstance().clearStackUpdateStatus(req.nodeId, stackName);
    invalidateNodeCaches(req.nodeId);
    console.log(`[Stacks] Update completed: ${stackName}`);
    if (debug) console.debug(`[Stacks:debug] Update finished in ${Date.now() - t0}ms`);
    res.json({ status: 'Update completed' });
    triggerPostDeployScan(stackName, req.nodeId).catch(err =>
      console.error(`[Security] Post-deploy scan failed for ${stackName}:`, err),
    );
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
    await ComposeService.getInstance(req.nodeId).deployStack(stackName, getTerminalWs(), false);
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
    const { name, type, compose_dir, is_default, api_url, api_token, mode } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Node name is required' });
    }
    if (!type || !['local', 'remote'].includes(type)) {
      return res.status(400).json({ error: 'Node type must be "local" or "remote"' });
    }

    const resolvedMode: 'proxy' | 'pilot_agent' = type === 'remote' && mode === 'pilot_agent' ? 'pilot_agent' : 'proxy';

    if (type === 'remote' && resolvedMode === 'proxy') {
      if (!api_url || typeof api_url !== 'string') {
        return res.status(400).json({ error: 'API URL is required for proxy-mode remote nodes' });
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
      api_url: resolvedMode === 'pilot_agent' ? '' : (api_url || ''),
      api_token: resolvedMode === 'pilot_agent' ? '' : (api_token || ''),
      mode: resolvedMode,
    });

    // Notify subscribers (e.g. DockerEventManager) so a new local node gets
    // its event stream spun up immediately, not on next restart.
    NodeRegistry.getInstance().notifyNodeAdded(id);

    let enrollment: ReturnType<typeof mintPilotEnrollment> | null = null;
    if (resolvedMode === 'pilot_agent') {
      enrollment = mintPilotEnrollment(id, req);
    }

    const isPlainHttp = resolvedMode === 'proxy' && type === 'remote' && api_url && api_url.startsWith('http://');
    res.json({
      success: true,
      id,
      ...(enrollment && { enrollment }),
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

/**
 * Mint a fresh 15-minute, single-use enrollment token for a pilot-mode node.
 * Stores a sha256 hash in pilot_enrollments so the token itself is never
 * recoverable from the DB. The returned `dockerRun` string is a copy-paste
 * starter command the admin runs on the remote host.
 */
function mintPilotEnrollment(nodeId: number, req: Request): { token: string; expiresAt: number; dockerRun: string } {
  const db = DatabaseService.getInstance();
  const jwtSecret = db.getGlobalSettings().auth_jwt_secret;
  if (!jwtSecret) throw new Error('JWT secret not configured');

  const ttlSeconds = 15 * 60;
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const enrollNonce = crypto.randomUUID();
  const token = jwt.sign(
    { scope: 'pilot_enroll', nodeId, enrollNonce },
    jwtSecret,
    { expiresIn: ttlSeconds },
  );
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.createPilotEnrollment(nodeId, tokenHash, expiresAt);

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = protoHeader || req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  const primaryUrl = `${protocol}://${host}`;

  const dockerRun =
    `docker run -d --restart=unless-stopped --name sencho-agent ` +
    `-v /var/run/docker.sock:/var/run/docker.sock ` +
    `-v sencho-agent-data:/app/data ` +
    `-v /opt/docker/sencho:/app/compose ` +
    `-e SENCHO_MODE=pilot ` +
    `-e SENCHO_PRIMARY_URL=${primaryUrl} ` +
    `-e SENCHO_ENROLL_TOKEN=${token} ` +
    `saelix/sencho:latest`;

  return { token, expiresAt, dockerRun };
}

// Regenerate an enrollment token for an existing pilot-mode node. Used when
// the first token expired before the agent was started, or when the agent
// container was lost and needs to re-enroll from scratch.
app.post('/api/nodes/:id/pilot/enroll', async (req: Request, res: Response) => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot manage nodes.', code: 'SCOPE_DENIED' });
    return;
  }
  const nodeIdStr = req.params.id as string;
  if (!requirePermission(req, res, 'node:manage', 'node', nodeIdStr)) return;
  try {
    const nodeId = parseInt(nodeIdStr, 10);
    if (!Number.isFinite(nodeId)) {
      return res.status(400).json({ error: 'Invalid node id' });
    }
    const node = DatabaseService.getInstance().getNode(nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    if (node.type !== 'remote' || node.mode !== 'pilot_agent') {
      return res.status(400).json({ error: 'Enrollment only applies to pilot-agent nodes' });
    }
    // Close any existing tunnel so the re-enrolling agent cleanly replaces it.
    PilotTunnelManager.getInstance().closeTunnel(nodeId, PilotCloseCode.EnrollmentRegenerated, 'enrollment regenerated');
    const enrollment = mintPilotEnrollment(nodeId, req);
    res.json({ success: true, enrollment });
  } catch (error: any) {
    console.error('Failed to regenerate pilot enrollment:', error);
    res.status(500).json({ error: error.message || 'Failed to regenerate enrollment' });
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
