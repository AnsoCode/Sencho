import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCount } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Bell, Zap, Shield, HardDrive, WifiOff, CheckCircle2,
} from 'lucide-react';
import type { ConfigurationStatusPayload } from '@/components/dashboard';

interface FleetNodeConfiguration {
  id: number;
  name: string;
  type: 'local' | 'remote';
  status: 'online' | 'offline';
  configuration: ConfigurationStatusPayload | null;
}

function TierChip({ tier }: { tier: string }) {
  const label = tier === 'admiral' ? 'Admiral' : 'Skipper';
  return (
    <span className="inline-flex items-center rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] leading-3 font-mono tracking-[0.18em] uppercase text-warning/80">
      {label}
    </span>
  );
}

function SummaryRow({ icon: Icon, label, value, locked, requiredTier }: {
  icon: typeof Bell;
  label: string;
  value: string;
  locked?: boolean;
  requiredTier?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <Icon className="h-3 w-3 shrink-0 text-stat-icon" strokeWidth={1.5} />
      <span className={`text-xs flex-1 ${locked ? 'text-stat-subtitle/60' : 'text-stat-subtitle'}`}>{label}</span>
      {locked && requiredTier
        ? <TierChip tier={requiredTier} />
        : <span className="text-xs font-mono tabular-nums text-stat-value">{value}</span>}
    </div>
  );
}

function NodeCard({ node }: { node: FleetNodeConfiguration }) {
  const isRemote = node.type === 'remote';
  if (!node.configuration) {
    return (
      <Card className="bg-card shadow-card-bevel">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-medium text-sm text-stat-value">{node.name}</span>
            <Badge variant="outline" className="text-[10px] font-normal py-0 px-1.5 text-stat-subtitle">
              {isRemote ? 'Remote' : 'Local'}
            </Badge>
            <WifiOff className="h-3.5 w-3.5 text-stat-subtitle ml-auto" strokeWidth={1.5} />
            <span className="text-xs text-stat-subtitle">Offline</span>
          </div>
          <p className="text-xs text-stat-subtitle/60">Node is unreachable. Configuration unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  const { notifications, automation, security, backup, thresholds } = node.configuration;

  const agentCount = [
    notifications.agents.discord.enabled,
    notifications.agents.slack.enabled,
    notifications.agents.webhook.enabled,
  ].filter(Boolean).length;

  return (
    <Card className="bg-card shadow-card-bevel">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-medium text-sm text-stat-value">{node.name}</span>
          <Badge variant="outline" className="text-[10px] font-normal py-0 px-1.5 text-stat-subtitle">
            {isRemote ? 'Remote' : 'Local'}
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={1.5} />
            <span className="text-xs text-success">Online</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <SummaryRow icon={Bell} label="Agents"
            value={agentCount === 0 ? 'None' : `${agentCount} active`} />
          <SummaryRow icon={Bell} label="Alert rules"
            value={formatCount(notifications.alertRules, 'rule')} />
          <SummaryRow icon={Zap} label="Auto-heal"
            value={automation.autoHeal.total === 0
              ? 'None'
              : `${automation.autoHeal.enabled}/${automation.autoHeal.total}`} />
          <SummaryRow icon={Zap} label="Webhooks"
            value={
              automation.webhooks.locked
                ? ''
                : formatCount(automation.webhooks.enabled, 'active')
            }
            locked={automation.webhooks.locked}
            requiredTier={automation.webhooks.locked ? automation.webhooks.requiredTier : undefined} />
          {!isRemote && (
            <SummaryRow icon={Shield} label="MFA"
              value={security.mfaEnabled === null ? 'Not set' : security.mfaEnabled ? 'On' : 'Off'} />
          )}
          <SummaryRow icon={Shield} label="Scanning"
            value={
              security.scanPolicies.locked
                ? ''
                : formatCount(security.scanPolicies.enabled, 'policy')
            }
            locked={security.scanPolicies.locked}
            requiredTier={security.scanPolicies.locked ? security.scanPolicies.requiredTier : undefined} />
          {!isRemote && (
            <SummaryRow icon={HardDrive} label="Backup"
              value={
                backup.locked
                  ? ''
                  : backup.provider === 'disabled' ? 'Disabled' : 'Enabled'
              }
              locked={backup.locked}
              requiredTier={backup.locked ? backup.requiredTier : undefined} />
          )}
          <SummaryRow icon={HardDrive} label="Crash detect"
            value={thresholds.globalCrash ? 'On' : 'Off'} />
        </div>
      </CardContent>
    </Card>
  );
}

export function FleetConfiguration() {
  const [nodes, setNodes] = useState<FleetNodeConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/fleet/configuration', { localOnly: true });
      if (!res.ok) {
        setError('Failed to fetch fleet configuration.');
        return;
      }
      const data = await res.json() as FleetNodeConfiguration[];
      setNodes(data);
      setError(null);
    } catch {
      setError('Unable to reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-1">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="bg-card shadow-card-bevel">
            <CardContent className="p-4 space-y-2">
              <div className="h-4 w-32 rounded-sm bg-accent/10 animate-pulse" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-3 rounded-sm bg-accent/10 animate-pulse" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-stat-subtitle">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-stat-subtitle">
        <p className="text-sm">No nodes configured.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-1">
      {nodes.map(node => <NodeCard key={node.id} node={node} />)}
    </div>
  );
}
