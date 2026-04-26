import { Router, type Request, type Response } from 'express';
import { DatabaseService } from '../services/DatabaseService';
import { CloudBackupService } from '../services/CloudBackupService';
import { authMiddleware } from '../middleware/auth';
import { effectiveTier, effectiveVariant } from '../middleware/tierGates';
import type { LicenseTier, LicenseVariant } from '../services/LicenseService';

export const dashboardRouter = Router();

export interface AgentStatus {
  configured: boolean;
  enabled: boolean;
}

export interface ConfigurationStatus {
  tier: LicenseTier;
  variant: LicenseVariant;
  notifications: {
    agents: { discord: AgentStatus; slack: AgentStatus; webhook: AgentStatus };
    alertRules: number;
    routingRules: { count: number; enabledCount: number; locked: boolean; requiredTier: 'admiral' };
  };
  automation: {
    autoHeal: { total: number; enabled: number };
    autoUpdate: { enabled: number; total: number };
    scheduledTasks: { total: number; enabled: number; locked: boolean; requiredTier: 'admiral' };
    webhooks: { total: number; enabled: number; locked: boolean; requiredTier: 'skipper' };
  };
  security: {
    mfaEnabled: boolean | null;
    ssoEnabled: boolean;
    ssoProvider: string | null;
    scanPolicies: { total: number; enabled: number; locked: boolean; requiredTier: 'skipper' };
  };
  thresholds: {
    cpuLimit: number;
    ramLimit: number;
    diskLimit: number;
    dockerJanitorGb: number;
    globalCrash: boolean;
  };
  backup: {
    provider: 'disabled' | 'sencho' | 'custom';
    autoUpload: boolean;
    locked: boolean;
    requiredTier: 'admiral';
  };
}

export function buildLocalConfigurationStatus(
  nodeId: number,
  userId: number,
  tier: LicenseTier,
  variant: LicenseVariant,
): ConfigurationStatus {
  const db = DatabaseService.getInstance();
  const isPaid = tier === 'paid';
  const isAdmiral = isPaid && variant === 'admiral';

  const agents = db.getAgents(nodeId);
  const agentByType = (type: 'discord' | 'slack' | 'webhook'): AgentStatus => {
    const a = agents.find(ag => ag.type === type);
    return { configured: !!a?.url, enabled: a?.enabled ?? false };
  };

  const alertRules = db.getStackAlerts().length;
  const notifRoutes = db.getNotificationRoutes();

  const healPolicies = db.getAutoHealPolicies();
  const autoUpdateMap = db.getStackAutoUpdateSettingsForNode(nodeId);
  const autoUpdateEnabled = Object.values(autoUpdateMap).filter(Boolean).length;
  const autoUpdateTotal = Object.keys(autoUpdateMap).length;
  const scheduledTasks = db.getScheduledTasks();
  const webhooks = db.getWebhooks();

  const mfaRow = userId ? db.getUserMfa(userId) : undefined;
  const ssoConfigs = db.getSSOConfigs();
  const enabledSso = ssoConfigs.find(c => c.enabled === 1);
  const scanPolicies = db.getScanPolicies();

  const settings = db.getGlobalSettings();
  const cpuLimit = parseInt(settings['host_cpu_limit'] ?? '90', 10);
  const ramLimit = parseInt(settings['host_ram_limit'] ?? '90', 10);
  const diskLimit = parseInt(settings['host_disk_limit'] ?? '90', 10);
  const dockerJanitorGb = parseFloat(settings['docker_janitor_gb'] ?? '5');
  const globalCrash = settings['global_crash'] === '1';

  const cloudSvc = CloudBackupService.getInstance();
  const cloudProvider = cloudSvc.getProvider();
  const cloudAutoUpload = cloudSvc.isAutoUploadOn();

  return {
    tier,
    variant,
    notifications: {
      agents: {
        discord: agentByType('discord'),
        slack: agentByType('slack'),
        webhook: agentByType('webhook'),
      },
      alertRules,
      routingRules: {
        count: notifRoutes.length,
        enabledCount: notifRoutes.filter(r => r.enabled).length,
        locked: !isAdmiral,
        requiredTier: 'admiral',
      },
    },
    automation: {
      autoHeal: {
        total: healPolicies.length,
        enabled: healPolicies.filter(p => p.enabled === 1).length,
      },
      autoUpdate: {
        enabled: autoUpdateEnabled,
        total: autoUpdateTotal,
      },
      scheduledTasks: {
        total: scheduledTasks.length,
        enabled: scheduledTasks.filter(t => t.enabled === 1).length,
        locked: !isAdmiral,
        requiredTier: 'admiral',
      },
      webhooks: {
        total: webhooks.length,
        enabled: webhooks.filter(w => w.enabled).length,
        locked: !isPaid,
        requiredTier: 'skipper',
      },
    },
    security: {
      mfaEnabled: mfaRow ? mfaRow.enabled === 1 : null,
      ssoEnabled: !!enabledSso,
      ssoProvider: enabledSso?.provider ?? null,
      scanPolicies: {
        total: scanPolicies.length,
        enabled: scanPolicies.filter(p => p.enabled === 1).length,
        locked: !isPaid,
        requiredTier: 'skipper',
      },
    },
    thresholds: {
      cpuLimit,
      ramLimit,
      diskLimit,
      dockerJanitorGb,
      globalCrash,
    },
    backup: {
      provider: cloudProvider,
      autoUpload: cloudAutoUpload,
      locked: !isAdmiral,
      requiredTier: 'admiral',
    },
  };
}

// Sits after authGate and before the remote proxy in index.ts so remote-node
// requests are transparently forwarded to the target Sencho instance.
dashboardRouter.get('/configuration', authMiddleware, (req: Request, res: Response): void => {
  try {
    const nodeId = req.nodeId ?? 0;
    const userId = req.user?.userId ?? 0;
    const tier = effectiveTier(req);
    const variant = effectiveVariant(req);

    res.json(buildLocalConfigurationStatus(nodeId, userId, tier, variant));
  } catch (error) {
    console.error('[Dashboard] Failed to build configuration status:', error);
    res.status(500).json({ error: 'Failed to fetch configuration status' });
  }
});

dashboardRouter.get('/recent-activity', authMiddleware, (req: Request, res: Response): void => {
  try {
    const db = DatabaseService.getInstance();
    const nodeId = req.nodeId ?? 0;
    const rawLimit = parseInt(String(req.query['limit'] ?? '10'), 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 10 : Math.min(rawLimit, 50);

    const items = db.getNotificationHistory(nodeId, limit);
    res.json(items);
  } catch (error) {
    console.error('[Dashboard] Failed to fetch recent activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});
