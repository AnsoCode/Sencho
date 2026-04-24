import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import DockerController, { globalDockerNetwork, type CreateNetworkOptions, type NetworkDriver } from './services/DockerController';
import type Dockerode from 'dockerode';
import { FileSystemService } from './services/FileSystemService';
import { ComposeService } from './services/ComposeService';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import si from 'systeminformation';
import path from 'path';
import { DatabaseService, Node, ScheduledTask, UserRole, ResourceType, parsePolicyEvaluation, type VulnerabilityScan } from './services/DatabaseService';
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
import { WebhookService } from './services/WebhookService';
import { SSOService } from './services/SSOService';
import { SchedulerService } from './services/SchedulerService';
import { RegistryService } from './services/RegistryService';
import { CacheService } from './services/CacheService';
import { CAPABILITIES, getSenchoVersion, isValidVersion, fetchRemoteMeta, type RemoteMeta } from './services/CapabilityRegistry';
import { GitSourceService, GitSourceError, sweepStaleTempDirs as sweepStaleGitTempDirs, repoHost as gitRepoHost } from './services/GitSourceService';
import { sendGitSourceError } from './utils/gitSourceHttp';
import './types/express';
import {
  PORT,
  MIN_PASSWORD_LENGTH,
  MFA_REPLAY_TTL_MS,
  MFA_REPLAY_PURGE_INTERVAL_MS,
  STATS_CACHE_TTL_MS,
  SYSTEM_STATS_CACHE_TTL_MS,
  STACK_STATUSES_CACHE_TTL_MS,
} from './helpers/constants';
import {
  checkPermission,
  requirePermission,
} from './middleware/permissions';
import {
  requirePaid,
  requireAdmiral,
  requireAdmin,
  requireNodeProxy,
  requireScheduledTaskTier,
} from './middleware/tierGates';
import {
  buildPolicyGateOptions,
  runPolicyGate,
  triggerPostDeployScan,
} from './helpers/policyGate';
import {
  webhookTriggerLimiter,
  trivyInstallLimiter,
} from './middleware/rateLimiters';
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
import { licenseRouter, systemUpdateRouter, scheduleLocalUpdate } from './routes/license';
import { permissionsRouter } from './routes/permissions';
import { convertRouter } from './routes/convert';
import { alertsRouter } from './routes/alerts';
import { labelsRouter, stackLabelsRouter } from './routes/labels';
import { apiTokensRouter } from './routes/apiTokens';
import { auditLogRouter } from './routes/auditLog';

import { isDebugEnabled } from './utils/debug';
import { getLatestVersion } from './utils/version-check';
import { getErrorMessage } from './utils/errors';
import { captureLocalNodeFiles, captureRemoteNodeFiles, SnapshotNodeData } from './utils/snapshot-capture';
import { GlobalLogEntry, normalizeContainerName, parseLogTimestamp, detectLogLevel, demuxDockerLog } from './utils/log-parsing';
import SelfUpdateService from './services/SelfUpdateService';
import TrivyService, { SbomFormat } from './services/TrivyService';
import TrivyInstaller from './services/TrivyInstaller';
import { enforcePolicyPreDeploy } from './services/PolicyEnforcement';
import { validateImageRef } from './utils/image-ref';
import { applySuppressions } from './utils/suppression-filter';
import { generateSarif } from './services/SarifExporter';
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

// --- Fleet Overview (local-only, aggregates all nodes) ---

// In-memory tracker for remote node updates (transient; lost on gateway restart).
const updateTracker = FleetUpdateTrackerService.getInstance();
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

// Fleet role: tells the frontend whether this Sencho is the control or a replica.
// The control serves read+write for security rules. Replicas are read-only and managed upstream.
app.get('/api/fleet/role', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  res.json({ role: FleetSyncService.getRole() });
});

const MAX_SYNC_ROWS = 5000;
const VALID_SEVERITY = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const isIntFlag = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

function validateScanPolicyRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return 'row must be an object';
  const r = row as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0 || r.name.length > 200) return 'name must be a non-empty string';
  if (typeof r.max_severity !== 'string' || !VALID_SEVERITY.has(r.max_severity)) return 'max_severity must be CRITICAL, HIGH, MEDIUM, or LOW';
  if (r.stack_pattern !== null && typeof r.stack_pattern !== 'string') return 'stack_pattern must be a string or null';
  if (typeof r.stack_pattern === 'string' && r.stack_pattern.length > 200) return 'stack_pattern is too long';
  if (typeof r.node_identity !== 'string') return 'node_identity must be a string';
  if (r.node_identity.length > 500) return 'node_identity is too long';
  if (!isIntFlag(r.block_on_deploy)) return 'block_on_deploy must be 0 or 1';
  if (!isIntFlag(r.enabled)) return 'enabled must be 0 or 1';
  return null;
}

const CVE_ID_RE = /^(CVE-\d{4}-\d{4,}|GHSA-[\w-]{14,})$/;

// Returns a normalized scanners array, undefined when no input was provided,
// or null when the input is present but invalid.
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
function validateCveSuppressionRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return 'row must be an object';
  const r = row as Record<string, unknown>;
  if (typeof r.cve_id !== 'string' || !CVE_ID_RE.test(r.cve_id)) return 'cve_id must be a valid CVE or GHSA identifier';
  if (r.pkg_name !== null && typeof r.pkg_name !== 'string') return 'pkg_name must be a string or null';
  if (typeof r.pkg_name === 'string' && r.pkg_name.length > 200) return 'pkg_name is too long';
  if (r.image_pattern !== null && typeof r.image_pattern !== 'string') return 'image_pattern must be a string or null';
  if (typeof r.image_pattern === 'string' && r.image_pattern.length > 300) return 'image_pattern is too long';
  if (typeof r.reason !== 'string') return 'reason must be a string';
  if (r.reason.length > 2000) return 'reason is too long';
  if (typeof r.created_by !== 'string' || r.created_by.length > 200) return 'created_by must be a string';
  if (typeof r.created_at !== 'number') return 'created_at must be a number';
  if (r.expires_at !== null && typeof r.expires_at !== 'number') return 'expires_at must be a number or null';
  return null;
}

// Fleet sync: receive a full replacement of a replicated resource from the control.
// Restricted to node_proxy Bearer tokens so only a sibling Sencho can push.
app.post('/api/fleet/sync/:resource', authMiddleware, (req: Request, res: Response): void => {
  if (!requireNodeProxy(req, res)) return;
  const resource = req.params.resource;
  if (resource !== 'scan_policies' && resource !== 'cve_suppressions') {
    res.status(400).json({ error: `Unsupported sync resource: ${resource}` });
    return;
  }
  const body = req.body ?? {};
  const rows = Array.isArray(body.rows) ? body.rows : null;
  const targetIdentity = typeof body.targetIdentity === 'string' ? body.targetIdentity : '';
  if (!rows) {
    res.status(400).json({ error: 'rows array is required' });
    return;
  }
  if (rows.length > MAX_SYNC_ROWS) {
    res.status(413).json({ error: `Too many rows (max ${MAX_SYNC_ROWS})` });
    return;
  }
  const validator = resource === 'scan_policies' ? validateScanPolicyRow : validateCveSuppressionRow;
  for (let i = 0; i < rows.length; i++) {
    const err = validator(rows[i]);
    if (err) {
      res.status(400).json({ error: `Invalid row at index ${i}: ${err}` });
      return;
    }
  }
  try {
    FleetSyncService.getInstance().applyIncomingSync(resource, rows, targetIdentity);
    res.json({ success: true, applied: rows.length });
  } catch (error) {
    console.error('[FleetSync] Failed to apply incoming sync:', error);
    res.status(500).json({ error: 'Failed to apply sync' });
  }
});

// Fleet sync status: surfaces per-node replication results so operators can spot stale replicas.
app.get('/api/fleet/sync-status', authMiddleware, (req: Request, res: Response): void => {
  if (!requireAdmin(req, res)) return;
  if (!requirePaid(req, res)) return;
  res.json(DatabaseService.getInstance().getFleetSyncStatuses());
});

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

// Fleet Update Status: returns version comparison and active update status for all nodes.
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
            updateTracker.set(node.id, updateTracker.resolve(tracker, 'timeout', UPDATE_TIMEOUT_MSG));
          } else if (node.type === 'remote') {
            if (remoteUpdateError) {
              // Remote reported a pull failure via /api/meta
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'reported pull failure:', remoteUpdateError);
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'failed', remoteUpdateError));
            } else if (!remoteOnline) {
              // Node is unreachable (restarting); record that it went offline
              if (!tracker.wasOffline) {
                if (debug) console.debug('[Fleet:debug] Node', node.id, 'went offline (restarting)');
                updateTracker.set(node.id, { ...tracker, wasOffline: true });
              }
            } else if (version !== tracker.previousVersion) {
              // Signal 1: Version changed (or version now resolvable after being unknown)
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 1 (version changed):', tracker.previousVersion, '->', version);
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'completed'));
            } else if (
              remoteStartedAt !== null &&
              tracker.previousProcessStart !== null &&
              remoteStartedAt !== tracker.previousProcessStart
            ) {
              // Signal 2: Process restarted (startedAt changed)
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 2 (process restarted):', tracker.previousProcessStart, '->', remoteStartedAt);
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'completed'));
            } else if (tracker.wasOffline && remoteOnline) {
              // Signal 3: Node went offline and is back online (container was recreated)
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'completed via signal 3 (offline then online)');
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'completed'));
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
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'completed'));
            } else if (elapsed > EARLY_FAIL_MS) {
              // Heuristic: node never went offline and nothing changed after 3 min
              if (debug) console.debug('[Fleet:debug] Node', node.id, 'early fail after', Math.round(elapsed / 1000) + 's - no signals detected');
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'failed', 'Update may have failed. The node is still running and its version has not changed.'));
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
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'failed', localError));
              selfUpdate.clearLastError();
            } else if (elapsed > EARLY_FAIL_MS) {
              // Helper container likely failed silently. Surface failure before the 5 min timeout.
              if (debug) console.debug('[Fleet:debug] Local node', node.id, 'early fail after', Math.round(elapsed / 1000) + 's');
              updateTracker.set(node.id, updateTracker.resolve(tracker, 'failed', 'Local update did not complete. The container may not have restarted; check Docker logs on the host.'));
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
        updateTracker.set(nodeId, updateTracker.resolve(existing, 'timeout', UPDATE_TIMEOUT_MSG));
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
      updateTracker.set(nodeId, updateTracker.create('updating', getSenchoVersion(), null));
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
      updateTracker.set(nodeId, updateTracker.create('failed', meta.version, meta.startedAt, errorMsg));
      res.status(502).json({ error: errorMsg });
      return;
    }

    updateTracker.set(nodeId, updateTracker.create('updating', meta.version, meta.startedAt));
    res.status(202).json({ message: `Update initiated on ${node.name}.` });
  } catch (error) {
    console.error('[Fleet] Node update error:', error);
    const errorMsg = (error as Error)?.message || 'Failed to trigger node update.';
    const failedNodeId = parseInt(req.params.nodeId as string, 10);
    if (!isNaN(failedNodeId)) {
      updateTracker.set(failedNodeId, updateTracker.create('failed', null, null, errorMsg));
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
        updateTracker.set(node.id, updateTracker.create('updating', meta.version, meta.startedAt));
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
  for (const [nodeId, tracker] of updateTracker.entries()) {
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
        // Stack may not exist yet before first restore; that is ok.
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
    const db = DatabaseService.getInstance();
    const users = db.getUsers();
    const mfaUserIds = db.getUsersWithMfaEnabled();
    const enriched = users.map((u) => ({
      ...u,
      mfaEnabled: mfaUserIds.has(u.id),
    }));
    res.json(enriched);
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

/**
 * Admin reset: clear a target user's MFA enrolment and force re-auth. Used
 * when a user has lost their authenticator AND exhausted their backup codes,
 * and another admin is available. For total lockout (including sole admin),
 * see the CLI `reset-mfa` command.
 */
app.post('/api/users/:id/mfa/reset', authMiddleware, (req: Request, res: Response): void => {
  if (req.apiTokenScope) {
    res.status(403).json({ error: 'API tokens cannot access user management.', code: 'SCOPE_DENIED' });
    return;
  }
  if (!requireAdmin(req, res)) return;
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    const db = DatabaseService.getInstance();
    const target = db.getUser(id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    db.deleteUserMfa(id);
    db.bumpTokenVersion(id);
    try {
      db.insertAuditLog({
        timestamp: Date.now(),
        username: req.user!.username,
        method: 'POST',
        path: req.originalUrl,
        status_code: 200,
        node_id: null,
        ip_address: req.ip || 'unknown',
        summary: `Admin reset two-factor authentication for ${target.username}`,
      });
    } catch (err) {
      console.warn('[MFA] Admin reset audit log write failed:', (err as Error).message);
    }
    console.log('[MFA] Admin reset: target=', target.username, 'by=', req.user!.username);
    if (isDebugEnabled()) {
      console.log('[MFA:diag] admin-reset target=', target.username, 'actor=', req.user!.username);
    }
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('[MFA] Admin reset error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to reset two-factor authentication' });
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

// ── Git sources ────────────────────────────────────────────────────────
// Status mapping and error helper live in utils/gitSourceHttp so the
// mapping can be unit-tested without spinning up the full app.

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
    if (result.deployed) {
      triggerPostDeployScan(stackName, req.nodeId).catch(err =>
        console.error(`[Security] Post-deploy scan failed for ${stackName}:`, err),
      );
    }
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

app.get('/api/agents', authMiddleware, async (req: Request, res: Response) => {
  try {
    const nodeId = req.nodeId ?? 0;
    const agents = DatabaseService.getInstance().getAgents(nodeId);
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
    const nodeId = req.nodeId ?? 0;
    DatabaseService.getInstance().upsertAgent(nodeId, { type, url, enabled });
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

    // Timeline view needs every firing inside a rolling window, not just the next run.
    const scheduler = SchedulerService.getInstance();
    const windowHours = Math.min(Math.max(Number(req.query.window_hours) || 24, 1), 168);
    const from = Date.now();
    const to = from + windowHours * 60 * 60 * 1000;
    const enriched = tasks.map(t => ({
      ...t,
      next_runs: t.enabled === 1 ? scheduler.calculateRunsWithin(t.cron_expression, from, to) : [],
    }));

    res.json(enriched);
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
    if (!['restart', 'snapshot', 'prune', 'update', 'scan'].includes(action)) {
      res.status(400).json({ error: 'Invalid action. Must be restart, snapshot, prune, update, or scan.' }); return;
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
    if (action === 'scan' && target_type !== 'system') {
      res.status(400).json({ error: 'Scan action requires target_type "system".' }); return;
    }
    if (action === 'scan' && !node_id) {
      res.status(400).json({ error: 'Scan action requires node_id.' }); return;
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
    if (action && !['restart', 'snapshot', 'prune', 'update', 'scan'].includes(action)) {
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
    if (finalAction === 'scan' && finalTargetType !== 'system') {
      res.status(400).json({ error: 'Scan action requires target_type "system".' }); return;
    }
    if (finalAction === 'scan') {
      const finalNodeId = node_id !== undefined ? node_id : existing.node_id;
      if (!finalNodeId) {
        res.status(400).json({ error: 'Scan action requires node_id.' }); return;
      }
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
