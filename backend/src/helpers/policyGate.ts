import type { Request, Response } from 'express';
import { enforcePolicyPreDeploy, type PolicyEnforcementOptions } from '../services/PolicyEnforcement';
import DockerController from '../services/DockerController';
import { DatabaseService } from '../services/DatabaseService';
import { NotificationService } from '../services/NotificationService';
import TrivyService, { DIGEST_CACHE_TTL_MS } from '../services/TrivyService';
import { getErrorMessage } from '../utils/errors';

// Bypass requires `?ignorePolicy=true` AND `req.user.role === 'admin'`. The
// `stack:deploy` permission alone is not sufficient because the `deployer`
// role has that permission for day-to-day deploys.
export function buildPolicyGateOptions(
  req: Request,
  overrides: { bypass?: boolean; actor?: string } = {},
): PolicyEnforcementOptions {
  const defaultBypass = req.query.ignorePolicy === 'true' && req.user?.role === 'admin';
  return {
    bypass: overrides.bypass ?? defaultBypass,
    actor: overrides.actor ?? req.user?.username ?? 'unknown',
    ip: (req.ip ?? req.socket.remoteAddress ?? '') as string,
    auditMethod: req.method,
    auditPath: req.originalUrl || req.url,
  };
}

/**
 * Returns true if the deploy may proceed. Returns false after sending a 409,
 * in which case the caller must return immediately.
 */
export async function runPolicyGate(
  req: Request,
  res: Response,
  stackName: string,
  nodeId: number,
): Promise<boolean> {
  const gate = await enforcePolicyPreDeploy(stackName, nodeId, buildPolicyGateOptions(req));
  if (!gate.ok) {
    res.status(409).json({
      error: `Policy "${gate.policy?.name}" blocked deploy: ${gate.violations.length} image(s) exceed ${gate.policy?.max_severity}`,
      policy: gate.policy && {
        id: gate.policy.id,
        name: gate.policy.name,
        maxSeverity: gate.policy.max_severity,
      },
      violations: gate.violations,
    });
    return false;
  }
  return true;
}

export async function triggerPostDeployScan(
  stackName: string,
  nodeId: number,
): Promise<void> {
  const svc = TrivyService.getInstance();
  if (!svc.isTrivyAvailable()) return;
  try {
    const docker = DockerController.getInstance(nodeId).getDocker();
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${stackName}`] },
    });
    const imageRefs = new Set<string>();
    for (const c of containers as Array<{ Image?: string }>) {
      if (c.Image && !c.Image.startsWith('sha256:')) imageRefs.add(c.Image);
    }
    if (imageRefs.size === 0) return;

    const db = DatabaseService.getInstance();

    for (const imageRef of imageRefs) {
      try {
        const digest = await svc.getImageDigest(imageRef, nodeId);
        if (digest) {
          const cached = db.getLatestScanByDigest(digest, 'vuln');
          if (cached && Date.now() - cached.scanned_at < DIGEST_CACHE_TTL_MS) continue;
        }
        const scan = await svc.runScanAndPersist(imageRef, nodeId, 'deploy', stackName);

        if (scan.critical_count > 0 || scan.high_count > 0) {
          NotificationService.getInstance().dispatchAlert(
            scan.critical_count > 0 ? 'error' : 'warning',
            `Vulnerability scan for ${imageRef}: ${scan.critical_count} critical, ${scan.high_count} high`,
            stackName,
          );
        }
      } catch (err) {
        const message = getErrorMessage(err, 'unknown error');
        console.error(`[Security] Post-deploy scan failed for ${imageRef}:`, message);
        NotificationService.getInstance().dispatchAlert(
          'warning',
          `Post-deploy scan failed for ${imageRef} (${stackName}): ${message}`,
          stackName,
        );
      }
    }
  } catch (err) {
    console.error(`[Security] triggerPostDeployScan error for ${stackName}:`, getErrorMessage(err, 'unknown error'));
  }
}
