import { Router, type Request, type Response } from 'express';
import path from 'path';
import YAML from 'yaml';
import { FileSystemService } from '../services/FileSystemService';
import { ComposeService } from '../services/ComposeService';
import DockerController from '../services/DockerController';
import { DatabaseService } from '../services/DatabaseService';
import { CacheService } from '../services/CacheService';
import { LicenseService } from '../services/LicenseService';
import { UpdatePreviewService } from '../services/UpdatePreviewService';
import { GitSourceService, GitSourceError, repoHost as gitRepoHost } from '../services/GitSourceService';
import { enforcePolicyPreDeploy } from '../services/PolicyEnforcement';
import { requirePermission } from '../middleware/permissions';
import { requirePaid, requireAdmin } from '../middleware/tierGates';
import { NotificationService } from '../services/NotificationService';
import { isValidStackName, isValidServiceName, isPathWithinBase } from '../utils/validation';
import { getErrorMessage } from '../utils/errors';
import { isDebugEnabled } from '../utils/debug';
import { sendGitSourceError } from '../utils/gitSourceHttp';
import { buildPolicyGateOptions, runPolicyGate, triggerPostDeployScan } from '../helpers/policyGate';
import { invalidateNodeCaches } from '../helpers/cacheInvalidation';
import { STACK_STATUSES_CACHE_TTL_MS } from '../helpers/constants';
import { getTerminalWs } from '../websocket/generic';

async function resolveAllEnvFilePaths(nodeId: number, stackName: string): Promise<string[]> {
  const fsService = FileSystemService.getInstance(nodeId);
  const stackDir = path.join(fsService.getBaseDir(), stackName);
  const defaultEnvPath = path.join(stackDir, '.env');

  try {
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

    const existing: string[] = [];
    for (const f of envFiles) {
      try {
        await fsService.access(f);
        existing.push(f);
      } catch {
        // File does not exist, skip
      }
    }
    return existing;
  } catch (error) {
    console.warn(`Could not parse compose.yaml for env_file resolution in stack "${stackName}":`, error);
  }

  try {
    await fsService.access(defaultEnvPath);
    return [defaultEnvPath];
  } catch {
    return [];
  }
}

export const stacksRouter = Router();

stacksRouter.get('/', async (req: Request, res: Response) => {
  try {
    const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
    res.json(stacks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stacks' });
  }
});

stacksRouter.get('/statuses', async (req: Request, res: Response) => {
  try {
    const result = await CacheService.getInstance().getOrFetch(
      `stack-statuses:${req.nodeId}`,
      STACK_STATUSES_CACHE_TTL_MS,
      async () => {
        const stacks = await FileSystemService.getInstance(req.nodeId).getStacks();
        const stackNames = stacks.map((s: string) => s.replace(/\.(yml|yaml)$/, ''));
        const dockerController = DockerController.getInstance(req.nodeId);
        const bulkInfo = await dockerController.getBulkStackStatuses(stackNames);
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

stacksRouter.get('/auto-update-settings', (req: Request, res: Response): void => {
  try {
    const settings = DatabaseService.getInstance().getStackAutoUpdateSettingsForNode(req.nodeId);
    res.json(settings);
  } catch (error) {
    console.error('[Stacks] Failed to fetch auto-update settings:', error);
    res.status(500).json({ error: 'Failed to fetch auto-update settings' });
  }
});

stacksRouter.get('/:stackName/auto-update', (req: Request, res: Response): void => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      res.status(400).json({ error: 'Invalid stack name' });
      return;
    }
    const enabled = DatabaseService.getInstance().getStackAutoUpdateEnabled(req.nodeId, stackName);
    res.json({ enabled });
  } catch (error) {
    console.error('[Stacks] Failed to fetch auto-update setting:', error);
    res.status(500).json({ error: 'Failed to fetch auto-update setting' });
  }
});

stacksRouter.put('/:stackName/auto-update', (req: Request, res: Response): void => {
  if (!requirePaid(req, res)) return;
  if (!requireAdmin(req, res)) return;
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      res.status(400).json({ error: 'Invalid stack name' });
      return;
    }
    const { enabled } = req.body as { enabled?: unknown };
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '"enabled" must be a boolean' });
      return;
    }
    DatabaseService.getInstance().upsertStackAutoUpdateEnabled(req.nodeId, stackName, enabled);
    NotificationService.getInstance().broadcastEvent({
      type: 'state-invalidate',
      scope: 'stack',
      nodeId: req.nodeId,
      stackName,
      action: 'auto-update-settings-changed',
      ts: Date.now(),
    });
    res.json({ enabled });
  } catch (error) {
    console.error('[Stacks] Failed to update auto-update setting:', error);
    res.status(500).json({ error: 'Failed to update auto-update setting' });
  }
});

stacksRouter.get('/:stackName', async (req: Request, res: Response) => {
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

stacksRouter.put('/:stackName', async (req: Request, res: Response) => {
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

stacksRouter.get('/:stackName/envs', async (req: Request, res: Response) => {
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

stacksRouter.get('/:stackName/env', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (!isValidStackName(stackName)) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const requestedFile = req.query.file as string | undefined;
    const envPaths = await resolveAllEnvFilePaths(req.nodeId, stackName);

    let envPath: string | undefined = envPaths[0];

    if (requestedFile) {
      if (envPaths.includes(requestedFile)) {
        envPath = requestedFile;
      } else {
        return res.status(400).json({ error: 'Requested env file not allowed' });
      }
    }

    // Default path with no env files yet: reply 200 with an empty body and a
    // header the frontend can read. This avoids surfacing a 404 for the
    // legitimate "stack has no .env yet" case, which previous flows
    // sometimes echoed back to the user as a confusing error string.
    if (!envPath) {
      res.setHeader('X-Env-Exists', 'false');
      return res.send('');
    }

    const fsService = FileSystemService.getInstance(req.nodeId);

    try {
      await fsService.access(envPath);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.error('[Sencho] Unexpected error checking env file existence:', (e as Error).message);
      }
      // No env file at the resolved path. For an explicit ?file= query we
      // surface a 404 (the caller asked for something specific). Otherwise
      // treat it as the empty-stack case above.
      if (requestedFile) {
        return res.status(404).json({ error: 'Env file not found' });
      }
      res.setHeader('X-Env-Exists', 'false');
      return res.send('');
    }

    try {
      const content = await fsService.readFile(envPath, 'utf-8');
      res.setHeader('X-Env-Exists', 'true');
      return res.send(content);
    } catch (e: unknown) {
      // TOCTOU: the file existed at access() but vanished before readFile().
      // Return the same friendly empty-body shape rather than a generic 500
      // that the frontend would otherwise echo as an opaque error.
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT' && !requestedFile) {
        res.setHeader('X-Env-Exists', 'false');
        return res.send('');
      }
      throw e;
    }
  } catch (error) {
    console.error('Failed to read env file:', error);
    res.status(500).json({ error: 'Failed to read env file' });
  }
});

stacksRouter.put('/:stackName/env', async (req: Request, res: Response) => {
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

    let envPath = envPaths[0];

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

stacksRouter.post('/', async (req: Request, res: Response) => {
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

stacksRouter.post('/from-git', async (req: Request, res: Response) => {
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

stacksRouter.delete('/:stackName', async (req: Request, res: Response) => {
  const stackName = req.params.stackName as string;
  if (!requirePermission(req, res, 'stack:delete', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    return res.status(400).json({ error: 'Invalid stack name' });
  }
  try {
    try {
      await ComposeService.getInstance(req.nodeId).downStack(stackName);
    } catch (downErr) {
      console.warn(`[Teardown] Docker down failed or nothing to clean up for ${stackName}`);
    }

    let fsErr: unknown = null;
    try {
      await FileSystemService.getInstance(req.nodeId).deleteStack(stackName);
    } catch (err) {
      fsErr = err;
      console.error(`[Stacks] File deletion failed for ${stackName}, continuing with DB cleanup:`, err);
    }

    DatabaseService.getInstance().clearStackUpdateStatus(req.nodeId, stackName);
    DatabaseService.getInstance().clearStackAutoUpdateSetting(req.nodeId, stackName);
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

stacksRouter.get('/:stackName/containers', async (req: Request, res: Response) => {
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

stacksRouter.get('/:stackName/services', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/deploy', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/down', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/restart', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/stop', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/start', async (req: Request, res: Response) => {
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

type ServiceAction = 'start' | 'stop' | 'restart';

async function handleServiceAction(
  req: Request,
  res: Response,
  action: ServiceAction,
): Promise<void> {
  const stackName = req.params.stackName as string;
  const serviceName = req.params.serviceName as string;
  if (!requirePermission(req, res, 'stack:deploy', 'stack', stackName)) return;
  if (!isValidStackName(stackName)) {
    res.status(400).json({ error: 'Invalid stack name' });
    return;
  }
  if (!isValidServiceName(serviceName)) {
    res.status(400).json({ error: 'Invalid service name' });
    return;
  }
  try {
    const dockerController = DockerController.getInstance(req.nodeId);
    const all = await dockerController.getContainersByStack(stackName);
    if (!all || all.length === 0) {
      res.status(404).json({ error: 'No containers found for this stack.' });
      return;
    }
    const matching = all.filter(c => c.Service === serviceName);
    if (matching.length === 0) {
      res.status(404).json({ error: `Service '${serviceName}' not found in stack '${stackName}'.` });
      return;
    }
    const op =
      action === 'start'
        ? (id: string) => dockerController.startContainer(id)
        : action === 'stop'
          ? (id: string) => dockerController.stopContainer(id)
          : (id: string) => dockerController.restartContainer(id);
    await Promise.all(matching.map(c => op(c.Id)));
    invalidateNodeCaches(req.nodeId);
    console.log(
      `[Stacks] Service ${action} completed: ${stackName}/${serviceName} (${matching.length} containers)`,
    );
    res.json({
      success: true,
      message: `Service ${action} completed via Engine API.`,
      count: matching.length,
    });
  } catch (error: unknown) {
    console.error(`[Stacks] Service ${action} failed: ${stackName}/${serviceName}`, error);
    res.status(500).json({ error: getErrorMessage(error, `Failed to ${action} service`) });
  }
}

stacksRouter.post('/:stackName/services/:serviceName/restart', (req, res) =>
  handleServiceAction(req, res, 'restart'));
stacksRouter.post('/:stackName/services/:serviceName/stop', (req, res) =>
  handleServiceAction(req, res, 'stop'));
stacksRouter.post('/:stackName/services/:serviceName/start', (req, res) =>
  handleServiceAction(req, res, 'start'));

stacksRouter.get('/:stackName/update-preview', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/update', async (req: Request, res: Response) => {
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

stacksRouter.post('/:stackName/rollback', async (req: Request, res: Response) => {
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

stacksRouter.get('/:stackName/backup', async (req: Request, res: Response) => {
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
