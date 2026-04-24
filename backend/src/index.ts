import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import DockerController, { globalDockerNetwork, type CreateNetworkOptions, type NetworkDriver } from './services/DockerController';
import { FileSystemService } from './services/FileSystemService';
import { ComposeService } from './services/ComposeService';
import crypto from 'crypto';
import si from 'systeminformation';
import path from 'path';
import { DatabaseService, parsePolicyEvaluation, type VulnerabilityScan } from './services/DatabaseService';
import { NotificationService } from './services/NotificationService';
import { MonitorService } from './services/MonitorService';
import { AutoHealService } from './services/AutoHealService';
import { DockerEventManager } from './services/DockerEventManager';
import { ImageUpdateService } from './services/ImageUpdateService';
import { UpdatePreviewService } from './services/UpdatePreviewService';
import { templateService } from './services/TemplateService';
import { ErrorParser } from './utils/ErrorParser';
import { NodeRegistry } from './services/NodeRegistry';
import { PilotTunnelManager } from './services/PilotTunnelManager';
import { PilotCloseCode } from './pilot/protocol';
import { FleetSyncService } from './services/FleetSyncService';
import { LicenseService } from './services/LicenseService';
import { SSOService } from './services/SSOService';
import { SchedulerService } from './services/SchedulerService';
import { RegistryService } from './services/RegistryService';
import { CacheService } from './services/CacheService';
import { CAPABILITIES, getSenchoVersion, fetchRemoteMeta, type RemoteMeta } from './services/CapabilityRegistry';
import { GitSourceService, GitSourceError, sweepStaleTempDirs as sweepStaleGitTempDirs, repoHost as gitRepoHost } from './services/GitSourceService';
import { sendGitSourceError } from './utils/gitSourceHttp';
import './types/express';
import {
  PORT,
  MFA_REPLAY_TTL_MS,
  MFA_REPLAY_PURGE_INTERVAL_MS,
  STATS_CACHE_TTL_MS,
  SYSTEM_STATS_CACHE_TTL_MS,
  STACK_STATUSES_CACHE_TTL_MS,
} from './helpers/constants';
import { requirePermission } from './middleware/permissions';
import {
  requirePaid,
  requireAdmiral,
  requireAdmin,
} from './middleware/tierGates';
import {
  buildPolicyGateOptions,
  runPolicyGate,
  triggerPostDeployScan,
} from './helpers/policyGate';
import { trivyInstallLimiter } from './middleware/rateLimiters';
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
import { mintConsoleSession } from './helpers/consoleSession';
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

import { isDebugEnabled } from './utils/debug';
import { getErrorMessage } from './utils/errors';
import { GlobalLogEntry, normalizeContainerName, parseLogTimestamp, detectLogLevel, demuxDockerLog } from './utils/log-parsing';
import SelfUpdateService from './services/SelfUpdateService';
import TrivyService, { SbomFormat } from './services/TrivyService';
import TrivyInstaller from './services/TrivyInstaller';
import { enforcePolicyPreDeploy } from './services/PolicyEnforcement';
import { validateImageRef } from './utils/image-ref';
import { applySuppressions } from './utils/suppression-filter';
import { generateSarif } from './services/SarifExporter';
import { z } from 'zod';
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

// Symbols still consumed by inline security and node routes still living in
// index.ts. These will move with their route groups in a later slice.
const updateTracker = FleetUpdateTrackerService.getInstance();
const CVE_ID_RE = /^(CVE-\d{4}-\d{4,}|GHSA-[\w-]{14,})$/;

function parseScannersInput(raw: unknown): readonly ('vuln' | 'secret')[] | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = new Set<'vuln' | 'secret'>();
  for (const item of raw) {
    if (item !== 'vuln' && item !== 'secret') return null;
    out.add(item);
  }
  return Array.from(out) as readonly ('vuln' | 'secret')[];
}

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

const AutoHealPolicyCreateSchema = z.object({
  stack_name: z.string().min(1).max(255),
  service_name: z.string().min(1).max(255).nullable().optional(),
  unhealthy_duration_mins: z.coerce.number().int().min(1).max(1440),
  cooldown_mins: z.coerce.number().int().min(1).max(1440).default(5),
  max_restarts_per_hour: z.coerce.number().int().min(1).max(60).default(3),
  auto_disable_after_failures: z.coerce.number().int().min(1).max(100).default(5),
});
const AutoHealPolicyUpdateSchema = AutoHealPolicyCreateSchema.partial().omit({ stack_name: true });

// ─── Auto-Heal Policies ───────────────────────────────────────────────────────

app.get('/api/auto-heal/policies', authMiddleware, (req: Request, res: Response): void => {
  if (!requirePaid(req, res)) return;
  const stackName = typeof req.query.stackName === 'string' ? req.query.stackName : undefined;
  try {
    res.json(DatabaseService.getInstance().getAutoHealPolicies(stackName));
  } catch (err) {
    console.error('[AutoHeal] Failed to list policies:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auto-heal/policies', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  const parsed = AutoHealPolicyCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { stack_name, service_name, unhealthy_duration_mins, cooldown_mins, max_restarts_per_hour, auto_disable_after_failures } = parsed.data;
  const now = Date.now();
  try {
    const policy = DatabaseService.getInstance().addAutoHealPolicy({
      stack_name,
      service_name: service_name ?? null,
      unhealthy_duration_mins,
      cooldown_mins,
      max_restarts_per_hour,
      auto_disable_after_failures,
      enabled: 1,
      consecutive_failures: 0,
      last_fired_at: 0,
      created_at: now,
      updated_at: now,
    });
    res.status(201).json(policy);
  } catch (err) {
    console.error('[AutoHeal] Failed to create policy:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/auto-heal/policies/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const parsed = AutoHealPolicyUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  try {
    const db = DatabaseService.getInstance();
    if (!db.getAutoHealPolicy(id)) { res.status(404).json({ error: 'Policy not found' }); return; }
    db.updateAutoHealPolicy(id, parsed.data);
    res.json(db.getAutoHealPolicy(id));
  } catch (err) {
    console.error('[AutoHeal] Failed to update policy:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/auto-heal/policies/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  try {
    const db = DatabaseService.getInstance();
    if (!db.getAutoHealPolicy(id)) { res.status(404).json({ error: 'Policy not found' }); return; }
    db.deleteAutoHealPolicy(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[AutoHeal] Failed to delete policy:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auto-heal/policies/:id/history', authMiddleware, (req: Request, res: Response): void => {
  if (!requirePaid(req, res)) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
  try {
    res.json(DatabaseService.getInstance().getAutoHealHistory(id, limit));
  } catch (err) {
    console.error('[AutoHeal] Failed to fetch history:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/notifications', authMiddleware, async (req: Request, res: Response) => {
  try {
    const nodeId = req.nodeId ?? 0;
    const history = DatabaseService.getInstance().getNotificationHistory(nodeId);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/read', authMiddleware, async (req: Request, res: Response) => {
  try {
    const nodeId = req.nodeId ?? 0;
    DatabaseService.getInstance().markAllNotificationsRead(nodeId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

app.delete('/api/notifications/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid notification ID' }); return; }
    const nodeId = req.nodeId ?? 0;
    DatabaseService.getInstance().deleteNotification(nodeId, id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.delete('/api/notifications', authMiddleware, async (req: Request, res: Response) => {
  try {
    const nodeId = req.nodeId ?? 0;
    DatabaseService.getInstance().deleteAllNotifications(nodeId);
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
    res.json({ token: mintConsoleSession() });
  } catch (error) {
    console.error('Failed to issue console token:', error);
    res.status(500).json({ error: 'Failed to issue console token' });
  }
});

// --- SSO Config Routes (admin, local-only) ---

app.get('/api/sso/config', (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access SSO configuration.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
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
  try {
    const provider = String(req.params.provider);
    const validProviders = ['ldap', 'oidc_google', 'oidc_github', 'oidc_okta', 'oidc_custom'];
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
        if ((provider === 'oidc_okta' || provider === 'oidc_custom') && !config.oidcIssuerUrl?.trim()) missing.push('Issuer URL');
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


// --- Scheduled Operations Routes (Admiral, admin-only, local-only) ---


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

    const imageRefs = templates.map(t => t.image).filter((i): i is string => !!i);
    const scanSummary = DatabaseService.getInstance().getLatestScanSummaryByImageRefs(req.nodeId, imageRefs);

    let featuredIndex = -1;
    let featuredStars = 0;
    templates.forEach((t, i) => {
      const s = t.stars ?? 0;
      if (s > featuredStars) {
        featuredStars = s;
        featuredIndex = i;
      }
    });

    const enriched = templates.map((t, i) => {
      const summary = t.image ? scanSummary.get(t.image) : undefined;
      const scan_status: 'clean' | 'vulnerable' | 'unscanned' = summary
        ? (summary.total === 0 ? 'clean' : 'vulnerable')
        : 'unscanned';
      return {
        ...t,
        scan_status,
        scan_cve_count: summary?.total ?? 0,
        scan_critical_count: summary?.critical ?? 0,
        scan_high_count: summary?.high ?? 0,
        featured: i === featuredIndex,
      };
    });

    res.json(enriched);
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
    const { stackName, template, envVars, skip_scan } = req.body;

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
    const composeYaml = templateService.generateComposeFromTemplate(template, stackName);
    await fsService.saveStackContent(stackName, composeYaml);

    // 3. Generate env string and save to default .env
    if (envVars && Object.keys(envVars).length > 0) {
      const envString = templateService.generateEnvString(envVars);
      const defaultEnvPath = path.join(stackPath, '.env');
      await fsPromises.writeFile(defaultEnvPath, envString, 'utf-8');
    }

    // 4. Deploy the stack with atomic rollback
    try {
      if (!(await runPolicyGate(req, res, stackName, req.nodeId))) {
        // Gate blocked: clean up the files we just wrote so the user can
        // retry after remediating the vulnerable image.
        try {
          await fsService.deleteStack(stackName);
        } catch (cleanupErr) {
          console.error(`[Templates] Cleanup after policy block failed for ${stackName}:`, cleanupErr);
        }
        return;
      }
      const atomic = LicenseService.getInstance().getTier() === 'paid';
      await ComposeService.getInstance(req.nodeId).deployStack(stackName, getTerminalWs(), atomic);
      invalidateNodeCaches(req.nodeId);
      console.log(`[Templates] Deploy completed: ${stackName}`);
      res.json({ success: true, message: 'Template deployed successfully' });
      if (!skip_scan) {
        triggerPostDeployScan(stackName, req.nodeId).catch(err =>
          console.error(`[Security] Post-deploy scan failed for ${stackName}:`, err),
        );
      }
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

        // Auto-update is a background action initiated by the scheduler. A
        // policy bypass is never appropriate here: if updated images fail
        // the gate, skip this stack and raise a notification so an operator
        // can review before retrying manually.
        const autoUpdateGate = await enforcePolicyPreDeploy(
          stackName,
          req.nodeId,
          buildPolicyGateOptions(req, {
            bypass: false,
            actor: `auto-update:${req.user?.username ?? 'scheduler'}`,
          }),
        );
        if (!autoUpdateGate.ok) {
          const blockedMsg = `Policy "${autoUpdateGate.policy?.name}" blocked auto-update: ${autoUpdateGate.violations.length} image(s) exceed ${autoUpdateGate.policy?.max_severity}`;
          NotificationService.getInstance().dispatchAlert('warning', blockedMsg, stackName);
          results.push(`Stack "${stackName}": ${blockedMsg}`);
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
// Vulnerability Scanning Routes
// =========================

app.get('/api/security/trivy-status', authMiddleware, (_req: Request, res: Response) => {
  const svc = TrivyService.getInstance();
  const installer = TrivyInstaller.getInstance();
  const settings = DatabaseService.getInstance().getGlobalSettings();
  res.json({
    available: svc.isTrivyAvailable(),
    version: svc.getVersion(),
    source: svc.getSource(),
    autoUpdate: settings.trivy_auto_update === '1',
    busy: installer.isBusy(),
  });
});

app.post('/api/security/trivy-install', trivyInstallLimiter, authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmiral(req, res)) return;
  const svc = TrivyService.getInstance();
  if (svc.getSource() === 'host') {
    res.status(409).json({ error: 'Trivy is already installed on the host PATH. Remove the host binary before managing it from Sencho.' });
    return;
  }
  if (svc.getSource() === 'managed') {
    res.status(409).json({ error: 'Trivy is already installed. Use the update endpoint instead.' });
    return;
  }
  try {
    const { version } = await TrivyInstaller.getInstance().install();
    await svc.detectTrivy();
    res.json({ version, source: svc.getSource(), available: svc.isTrivyAvailable() });
  } catch (err) {
    const msg = getErrorMessage(err, 'Install failed');
    console.error('[Security] Trivy install failed:', msg);
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/security/trivy-install', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmiral(req, res)) return;
  const svc = TrivyService.getInstance();
  if (svc.getSource() !== 'managed') {
    res.status(409).json({ error: 'No managed Trivy install to remove' });
    return;
  }
  try {
    await TrivyInstaller.getInstance().uninstall();
    await svc.detectTrivy();
    res.json({ available: svc.isTrivyAvailable(), source: svc.getSource() });
  } catch (err) {
    const msg = getErrorMessage(err, 'Uninstall failed');
    console.error('[Security] Trivy uninstall failed:', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/security/trivy-update-check', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmiral(req, res)) return;
  const svc = TrivyService.getInstance();
  if (svc.getSource() !== 'managed') {
    res.status(409).json({ error: 'Update checks only apply to managed installs' });
    return;
  }
  try {
    const result = await TrivyInstaller.getInstance().checkForUpdate(svc.getVersion(), svc.getSource());
    res.json(result);
  } catch (err) {
    const msg = getErrorMessage(err, 'Update check failed');
    console.error('[Security] Trivy update check failed:', msg);
    res.status(502).json({ error: msg });
  }
});

app.post('/api/security/trivy-update', trivyInstallLimiter, authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmiral(req, res)) return;
  const svc = TrivyService.getInstance();
  if (svc.getSource() !== 'managed') {
    res.status(409).json({ error: 'Update only applies to managed installs' });
    return;
  }
  try {
    const { version } = await TrivyInstaller.getInstance().update();
    await svc.detectTrivy();
    res.json({ version, source: svc.getSource(), available: svc.isTrivyAvailable() });
  } catch (err) {
    const msg = getErrorMessage(err, 'Update failed');
    console.error('[Security] Trivy update failed:', msg);
    res.status(500).json({ error: msg });
  }
});

app.put('/api/security/trivy-auto-update', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmiral(req, res)) return;
  const enabled = req.body?.enabled === true;
  try {
    DatabaseService.getInstance().updateGlobalSetting('trivy_auto_update', enabled ? '1' : '0');
    res.json({ autoUpdate: enabled });
  } catch (err) {
    const msg = getErrorMessage(err, 'Failed to update setting');
    console.error('[Security] Trivy auto-update toggle failed:', msg);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/security/scan', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  const svc = TrivyService.getInstance();
  if (!svc.isTrivyAvailable()) {
    res.status(503).json({ error: 'Trivy is not available on this host' });
    return;
  }
  const rawImageRef = typeof req.body?.imageRef === 'string' ? req.body.imageRef.trim() : '';
  if (!rawImageRef) {
    res.status(400).json({ error: 'imageRef is required' });
    return;
  }
  if (!validateImageRef(rawImageRef)) {
    res.status(400).json({ error: 'Invalid imageRef format' });
    return;
  }
  const imageRef = rawImageRef;
  const stackContext = typeof req.body?.stackName === 'string' ? req.body.stackName : null;
  const force = req.body?.force === true;
  const scanners = parseScannersInput(req.body?.scanners);
  if (scanners === null) {
    res.status(400).json({ error: 'scanners must be an array of "vuln" or "secret"' });
    return;
  }
  if (scanners?.includes('secret') && !requirePaid(req, res)) return;
  const nodeId = req.nodeId;
  if (svc.isScanning(nodeId, imageRef)) {
    res.status(409).json({ error: 'Already scanning this image' });
    return;
  }
  const scanId = svc.beginScan(imageRef, nodeId, 'manual', stackContext, scanners);
  res.status(202).json({ scanId });

  svc.finishScan(scanId, imageRef, nodeId, { useCache: !force, scanners }).catch((err) => {
    console.error(`[Security] Scan failed for ${imageRef}:`, (err as Error).message);
  });
});

app.post('/api/security/scan/stack', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  const svc = TrivyService.getInstance();
  if (!svc.isTrivyAvailable()) {
    res.status(503).json({ error: 'Trivy is not available on this host' }); return;
  }
  const stackName = typeof req.body?.stackName === 'string' ? req.body.stackName.trim() : '';
  if (!stackName || !/^[a-zA-Z0-9_-]+$/.test(stackName)) {
    res.status(400).json({ error: 'Invalid stack name' }); return;
  }
  try {
    const scan = await svc.scanComposeStack(req.nodeId, stackName, 'manual');
    res.status(201).json(scan);
  } catch (error) {
    const message = (error as Error).message || '';
    if (message === 'Invalid stack path' || message.startsWith('No compose file found')) {
      res.status(404).json({ error: message }); return;
    }
    console.error('[Security] Stack config scan failed:', error);
    res.status(500).json({ error: message || 'Failed to scan stack' });
  }
});

function shapeScanForResponse(scan: VulnerabilityScan): Omit<VulnerabilityScan, 'policy_evaluation'> & {
  policy_evaluation: ReturnType<typeof parsePolicyEvaluation>;
} {
  const { policy_evaluation, ...rest } = scan;
  return { ...rest, policy_evaluation: parsePolicyEvaluation(policy_evaluation) };
}

app.get('/api/security/scans', authMiddleware, (req: Request, res: Response) => {
  try {
    const imageRef = typeof req.query.imageRef === 'string' ? req.query.imageRef : undefined;
    const imageRefLike =
      typeof req.query.imageRefLike === 'string' && req.query.imageRefLike.trim()
        ? req.query.imageRefLike.trim()
        : undefined;
    const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status =
      statusParam === 'completed' || statusParam === 'in_progress' || statusParam === 'failed'
        ? statusParam
        : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const result = DatabaseService.getInstance().getVulnerabilityScans(req.nodeId, {
      imageRef,
      imageRefLike,
      status,
      limit,
      offset,
    });
    res.json({ ...result, items: result.items.map(shapeScanForResponse) });
  } catch (error) {
    console.error('[Security] Failed to list scans:', error);
    res.status(500).json({ error: 'Failed to list scans' });
  }
});

app.get('/api/security/scans/:scanId', authMiddleware, (req: Request, res: Response): void => {
  const scanId = Number(req.params.scanId);
  if (!Number.isFinite(scanId)) {
    res.status(400).json({ error: 'Invalid scan id' }); return;
  }
  const scan = DatabaseService.getInstance().getVulnerabilityScan(scanId);
  if (!scan || scan.node_id !== req.nodeId) {
    res.status(404).json({ error: 'Scan not found' }); return;
  }
  res.json(shapeScanForResponse(scan));
});

app.get(
  '/api/security/scans/:scanId/vulnerabilities',
  authMiddleware,
  (req: Request, res: Response): void => {
    const scanId = Number(req.params.scanId);
    if (!Number.isFinite(scanId)) {
      res.status(400).json({ error: 'Invalid scan id' }); return;
    }
    const db = DatabaseService.getInstance();
    const scan = db.getVulnerabilityScan(scanId);
    if (!scan || scan.node_id !== req.nodeId) {
      res.status(404).json({ error: 'Scan not found' }); return;
    }
    const severity = typeof req.query.severity === 'string'
      ? (req.query.severity.toUpperCase() as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN')
      : undefined;
    const validSeverities = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
    if (severity && !validSeverities.has(severity)) {
      res.status(400).json({ error: 'Invalid severity filter' }); return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const result = db.getVulnerabilityDetails(scanId, { severity, limit, offset });
    const suppressions = db.getCveSuppressions();
    const enriched = applySuppressions(result.items, scan.image_ref, suppressions);
    res.json({ ...result, items: enriched });
  },
);

app.get(
  '/api/security/scans/:scanId/secrets',
  authMiddleware,
  (req: Request, res: Response): void => {
    if (!requirePaid(req, res)) return;
    const scanId = Number(req.params.scanId);
    if (!Number.isFinite(scanId)) {
      res.status(400).json({ error: 'Invalid scan id' }); return;
    }
    const db = DatabaseService.getInstance();
    const scan = db.getVulnerabilityScan(scanId);
    if (!scan || scan.node_id !== req.nodeId) {
      res.status(404).json({ error: 'Scan not found' }); return;
    }
    const severity = typeof req.query.severity === 'string'
      ? (req.query.severity.toUpperCase() as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN')
      : undefined;
    const validSeverities = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
    if (severity && !validSeverities.has(severity)) {
      res.status(400).json({ error: 'Invalid severity filter' }); return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(db.getSecretFindings(scanId, { severity, limit, offset }));
  },
);

app.get(
  '/api/security/scans/:scanId/misconfigs',
  authMiddleware,
  (req: Request, res: Response): void => {
    if (!requirePaid(req, res)) return;
    const scanId = Number(req.params.scanId);
    if (!Number.isFinite(scanId)) {
      res.status(400).json({ error: 'Invalid scan id' }); return;
    }
    const db = DatabaseService.getInstance();
    const scan = db.getVulnerabilityScan(scanId);
    if (!scan || scan.node_id !== req.nodeId) {
      res.status(404).json({ error: 'Scan not found' }); return;
    }
    const severity = typeof req.query.severity === 'string'
      ? (req.query.severity.toUpperCase() as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN')
      : undefined;
    const validSeverities = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
    if (severity && !validSeverities.has(severity)) {
      res.status(400).json({ error: 'Invalid severity filter' }); return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(db.getMisconfigFindings(scanId, { severity, limit, offset }));
  },
);

app.get('/api/security/image-summaries', authMiddleware, (req: Request, res: Response) => {
  try {
    const summaries = DatabaseService.getInstance().getImageScanSummaries(req.nodeId);
    res.json(summaries);
  } catch (error) {
    console.error('[Security] Failed to fetch image summaries:', error);
    res.status(500).json({ error: 'Failed to fetch image summaries' });
  }
});

app.post('/api/security/sbom', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  const svc = TrivyService.getInstance();
  if (!svc.isTrivyAvailable()) {
    res.status(503).json({ error: 'Trivy is not available on this host' }); return;
  }
  const imageRef = typeof req.body?.imageRef === 'string' ? req.body.imageRef.trim() : '';
  const formatRaw = typeof req.body?.format === 'string' ? req.body.format : 'spdx-json';
  if (!imageRef) {
    res.status(400).json({ error: 'imageRef is required' }); return;
  }
  if (!validateImageRef(imageRef)) {
    res.status(400).json({ error: 'Invalid imageRef format' }); return;
  }
  if (formatRaw !== 'spdx-json' && formatRaw !== 'cyclonedx') {
    res.status(400).json({ error: 'format must be spdx-json or cyclonedx' }); return;
  }
  try {
    const sbom = await svc.generateSBOM(imageRef, formatRaw as SbomFormat);
    const safeName = imageRef.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = formatRaw === 'spdx-json' ? 'spdx.json' : 'cdx.json';
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${ext}"`);
    res.send(sbom);
  } catch (error) {
    console.error('[Security] SBOM generation failed:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to generate SBOM' });
  }
});

app.get(
  '/api/security/scans/:scanId/sarif',
  authMiddleware,
  (req: Request, res: Response): void => {
    if (!requireAdmin(req, res)) return;
    if (!requirePaid(req, res)) return;
    const scanId = Number(req.params.scanId);
    if (!Number.isFinite(scanId)) {
      res.status(400).json({ error: 'Invalid scan id' }); return;
    }
    const db = DatabaseService.getInstance();
    const scan = db.getVulnerabilityScan(scanId);
    if (!scan || scan.node_id !== req.nodeId) {
      res.status(404).json({ error: 'Scan not found' }); return;
    }
    if (scan.status !== 'completed') {
      res.status(409).json({ error: 'Scan not complete' }); return;
    }
    const fetchAll = <T,>(
      q: (opts: { limit?: number; offset?: number }) => { items: T[]; total: number },
    ): T[] => {
      const pageSize = 1000;
      const collected: T[] = [];
      let offset = 0;
      while (true) {
        const page = q({ limit: pageSize, offset });
        collected.push(...page.items);
        if (collected.length >= page.total || page.items.length === 0) break;
        offset += page.items.length;
      }
      return collected;
    };
    try {
      const details = fetchAll((opts) => db.getVulnerabilityDetails(scanId, opts));
      const secrets = fetchAll((opts) => db.getSecretFindings(scanId, opts));
      const misconfigs = fetchAll((opts) => db.getMisconfigFindings(scanId, opts));
      const suppressed = applySuppressions(details, scan.image_ref, db.getCveSuppressions());
      const sarif = generateSarif(scan, suppressed, secrets, misconfigs);
      const safeName = scan.image_ref.replace(/[^a-zA-Z0-9._-]/g, '_') || `scan-${scanId}`;
      res.setHeader('Content-Type', 'application/sarif+json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.sarif.json"`);
      res.send(JSON.stringify(sarif));
    } catch (error) {
      console.error('[Security] SARIF export failed:', error);
      res.status(500).json({ error: (error as Error).message || 'Failed to generate SARIF' });
    }
  },
);

app.get('/api/security/policies', authMiddleware, (req: Request, res: Response): void => {
  if (!requirePaid(req, res)) return;
  res.json(DatabaseService.getInstance().getScanPolicies());
});

app.post('/api/security/policies', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({ error: 'Security policies are managed from the control node.' });
    return;
  }
  const { name, node_id, stack_pattern, max_severity, block_on_deploy, enabled } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Policy name is required' }); return;
  }
  const validSeverities = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  if (!validSeverities.has(max_severity)) {
    res.status(400).json({ error: 'max_severity must be CRITICAL, HIGH, MEDIUM, or LOW' }); return;
  }
  try {
    const resolvedNodeId = node_id != null ? Number(node_id) : null;
    const policy = DatabaseService.getInstance().createScanPolicy({
      name: name.trim(),
      node_id: resolvedNodeId,
      node_identity: FleetSyncService.resolveIdentityForNodeId(resolvedNodeId),
      stack_pattern: stack_pattern ? String(stack_pattern) : null,
      max_severity,
      block_on_deploy: block_on_deploy ? 1 : 0,
      enabled: enabled === false ? 0 : 1,
      replicated_from_control: 0,
    });
    FleetSyncService.getInstance().pushResourceAsync('scan_policies');
    res.status(201).json(policy);
  } catch (error) {
    console.error('[Security] Failed to create policy:', error);
    res.status(500).json({ error: 'Failed to create policy' });
  }
});

app.put('/api/security/policies/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({ error: 'Security policies are managed from the control node.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid policy id' }); return;
  }
  const body = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.node_id !== undefined) {
    const resolvedNodeId = body.node_id != null ? Number(body.node_id) : null;
    updates.node_id = resolvedNodeId;
    updates.node_identity = FleetSyncService.resolveIdentityForNodeId(resolvedNodeId);
  }
  if (body.stack_pattern !== undefined) updates.stack_pattern = body.stack_pattern ? String(body.stack_pattern) : null;
  if (body.max_severity !== undefined) {
    const validSeverities = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
    if (!validSeverities.has(body.max_severity)) {
      res.status(400).json({ error: 'max_severity must be CRITICAL, HIGH, MEDIUM, or LOW' }); return;
    }
    updates.max_severity = body.max_severity;
  }
  if (body.block_on_deploy !== undefined) updates.block_on_deploy = body.block_on_deploy ? 1 : 0;
  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
  const policy = DatabaseService.getInstance().updateScanPolicy(id, updates);
  if (!policy) {
    res.status(404).json({ error: 'Policy not found' }); return;
  }
  FleetSyncService.getInstance().pushResourceAsync('scan_policies');
  res.json(policy);
});

app.delete('/api/security/policies/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({ error: 'Security policies are managed from the control node.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid policy id' }); return;
  }
  DatabaseService.getInstance().deleteScanPolicy(id);
  FleetSyncService.getInstance().pushResourceAsync('scan_policies');
  res.json({ success: true });
});

// CVE suppressions. Rules live on the control instance and replicate fleet-wide.
// Reads are open to any authenticated user so operators on replicas can audit; writes
// are admin-only and rejected on replicas.

app.get('/api/security/suppressions', authMiddleware, (req: Request, res: Response): void => {
  if (!requirePaid(req, res)) return;
  const now = Date.now();
  const rows = DatabaseService.getInstance().getCveSuppressions().map((s) => ({
    ...s,
    active: s.expires_at === null || s.expires_at > now,
  }));
  res.json(rows);
});

app.post('/api/security/suppressions', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({ error: 'CVE suppressions are managed from the control node.' });
    return;
  }
  const body = req.body ?? {};
  const cveId = typeof body.cve_id === 'string' ? body.cve_id.trim() : '';
  if (!CVE_ID_RE.test(cveId)) {
    res.status(400).json({ error: 'cve_id must look like CVE-YYYY-NNNN or GHSA-xxxx-xxxx-xxxx' });
    return;
  }
  const pkgName = body.pkg_name == null || body.pkg_name === '' ? null : String(body.pkg_name).trim();
  if (pkgName !== null && pkgName.length > 200) {
    res.status(400).json({ error: 'pkg_name is too long' }); return;
  }
  const imagePattern = body.image_pattern == null || body.image_pattern === '' ? null : String(body.image_pattern).trim();
  if (imagePattern !== null && imagePattern.length > 300) {
    res.status(400).json({ error: 'image_pattern is too long' }); return;
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    res.status(400).json({ error: 'reason is required' }); return;
  }
  if (reason.length > 2000) {
    res.status(400).json({ error: 'reason is too long' }); return;
  }
  const expiresAt = body.expires_at == null ? null : Number(body.expires_at);
  if (expiresAt !== null && !Number.isFinite(expiresAt)) {
    res.status(400).json({ error: 'expires_at must be a timestamp or null' }); return;
  }
  try {
    const suppression = DatabaseService.getInstance().createCveSuppression({
      cve_id: cveId,
      pkg_name: pkgName,
      image_pattern: imagePattern,
      reason,
      created_by: req.user?.username || 'unknown',
      created_at: Date.now(),
      expires_at: expiresAt,
      replicated_from_control: 0,
    });
    FleetSyncService.getInstance().pushResourceAsync('cve_suppressions');
    res.status(201).json(suppression);
  } catch (error) {
    const message = (error as Error).message || '';
    if (message.includes('UNIQUE')) {
      res.status(409).json({ error: 'A suppression already exists for this CVE, package, and image pattern.' });
      return;
    }
    console.error('[Security] Failed to create suppression:', error);
    res.status(500).json({ error: 'Failed to create suppression' });
  }
});

app.put('/api/security/suppressions/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({ error: 'CVE suppressions are managed from the control node.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid suppression id' }); return;
  }
  const body = req.body ?? {};
  const updates: Partial<{ reason: string; image_pattern: string | null; expires_at: number | null }> = {};
  if (body.reason !== undefined) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) { res.status(400).json({ error: 'reason is required' }); return; }
    if (reason.length > 2000) { res.status(400).json({ error: 'reason is too long' }); return; }
    updates.reason = reason;
  }
  if (body.image_pattern !== undefined) {
    const pattern = body.image_pattern == null || body.image_pattern === '' ? null : String(body.image_pattern).trim();
    if (pattern !== null && pattern.length > 300) {
      res.status(400).json({ error: 'image_pattern is too long' }); return;
    }
    updates.image_pattern = pattern;
  }
  if (body.expires_at !== undefined) {
    const expiresAt = body.expires_at == null ? null : Number(body.expires_at);
    if (expiresAt !== null && !Number.isFinite(expiresAt)) {
      res.status(400).json({ error: 'expires_at must be a timestamp or null' }); return;
    }
    updates.expires_at = expiresAt;
  }
  const suppression = DatabaseService.getInstance().updateCveSuppression(id, updates);
  if (!suppression) {
    res.status(404).json({ error: 'Suppression not found' }); return;
  }
  FleetSyncService.getInstance().pushResourceAsync('cve_suppressions');
  res.json(suppression);
});

app.delete('/api/security/suppressions/:id', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({ error: 'CVE suppressions are managed from the control node.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid suppression id' }); return;
  }
  DatabaseService.getInstance().deleteCveSuppression(id);
  FleetSyncService.getInstance().pushResourceAsync('cve_suppressions');
  res.json({ success: true });
});

app.get('/api/security/compare', authMiddleware, (req: Request, res: Response): void => {
  if (!requirePaid(req, res)) return;
  const scanId1 = Number(req.query.scanId1);
  const scanId2 = Number(req.query.scanId2);
  if (!Number.isFinite(scanId1) || !Number.isFinite(scanId2)) {
    res.status(400).json({ error: 'scanId1 and scanId2 are required' }); return;
  }
  const db = DatabaseService.getInstance();
  const a = db.getVulnerabilityScan(scanId1);
  const b = db.getVulnerabilityScan(scanId2);
  if (!a || !b || a.node_id !== req.nodeId || b.node_id !== req.nodeId) {
    res.status(404).json({ error: 'One or both scans not found' }); return;
  }
  const COMPARE_ROW_LIMIT = 1000;
  const aVulns = db.getVulnerabilityDetails(scanId1, { limit: COMPARE_ROW_LIMIT }).items;
  const bVulns = db.getVulnerabilityDetails(scanId2, { limit: COMPARE_ROW_LIMIT }).items;
  const truncated =
    a.total_vulnerabilities > COMPARE_ROW_LIMIT || b.total_vulnerabilities > COMPARE_ROW_LIMIT;
  if (truncated) {
    console.warn(
      `[Compare] scan(s) exceed ${COMPARE_ROW_LIMIT}-row cap: scanA=${a.id}(${a.total_vulnerabilities}) scanB=${b.id}(${b.total_vulnerabilities})`,
    );
  }
  const keyOf = (v: { vulnerability_id: string; pkg_name: string }) =>
    `${v.vulnerability_id}::${v.pkg_name}`;
  const aMap = new Map(aVulns.map((v) => [keyOf(v), v]));
  const bMap = new Map(bVulns.map((v) => [keyOf(v), v]));
  const addedRaw = bVulns.filter((v) => !aMap.has(keyOf(v)));
  const removedRaw = aVulns.filter((v) => !bMap.has(keyOf(v)));
  const unchangedRaw = aVulns.filter((v) => bMap.has(keyOf(v)));
  const suppressions = db.getCveSuppressions();
  const added = applySuppressions(addedRaw, b.image_ref, suppressions);
  const removed = applySuppressions(removedRaw, a.image_ref, suppressions);
  const unchanged = applySuppressions(unchangedRaw, b.image_ref, suppressions);
  if (isDebugEnabled()) {
    console.log('[Compare:diag]', {
      scanId1,
      scanId2,
      reqNodeId: req.nodeId,
      tier: req.proxyTier ?? LicenseService.getInstance().getTier(),
      aVulns: aVulns.length,
      bVulns: bVulns.length,
      added: added.length,
      removed: removed.length,
      unchanged: unchanged.length,
      suppressions: suppressions.length,
      truncated,
    });
  }
  res.json({
    scanA: {
      id: a.id,
      scanned_at: a.scanned_at,
      image_ref: a.image_ref,
      total_vulnerabilities: a.total_vulnerabilities,
    },
    scanB: {
      id: b.id,
      scanned_at: b.scanned_at,
      image_ref: b.image_ref,
      total_vulnerabilities: b.total_vulnerabilities,
    },
    added,
    removed,
    unchanged,
    truncated,
    row_limit: COMPARE_ROW_LIMIT,
  });
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
