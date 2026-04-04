import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Activity, Bell } from 'lucide-react';
import type { Stats, SystemStats, NotificationItem, HealthLevel } from './types';

interface HealthStatusBarProps {
  stats: Stats;
  systemStats: SystemStats | null;
  notifications: NotificationItem[];
  activeNodeName: string;
  lastUpdated: number;
}

function deriveHealth(stats: Stats, systemStats: SystemStats | null, notifications: NotificationItem[]): HealthLevel {
  const cpu = parseFloat(systemStats?.cpu.usage || '0');
  const ram = parseFloat(systemStats?.memory.usagePercent || '0');
  const disk = parseFloat(systemStats?.disk?.usagePercent || '0');
  const unreadErrors = notifications.filter(n => !n.is_read && n.level === 'error').length;

  if (cpu >= 90 || ram >= 90 || disk >= 90 || (stats.exited > 0 && unreadErrors > 0)) return 'critical';
  if (cpu >= 80 || ram >= 80 || disk >= 80 || unreadErrors > 0) return 'degraded';
  return 'healthy';
}

const healthConfig: Record<HealthLevel, { label: string; dotClass: string; textClass: string }> = {
  healthy: { label: 'Healthy', dotClass: 'bg-success', textClass: 'text-success' },
  degraded: { label: 'Degraded', dotClass: 'bg-warning animate-pulse', textClass: 'text-warning' },
  critical: { label: 'Critical', dotClass: 'bg-destructive animate-pulse', textClass: 'text-destructive' },
};

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function HealthStatusBar({ stats, systemStats, notifications, activeNodeName, lastUpdated }: HealthStatusBarProps) {
  const health = useMemo(
    () => deriveHealth(stats, systemStats, notifications),
    [stats, systemStats, notifications]
  );
  const config = healthConfig[health];
  const unreadAlerts = notifications.filter(n => !n.is_read).length;

  return (
    <Card className="bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Health badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
            <span className={`font-mono text-sm font-medium ${config.textClass}`}>
              {config.label}
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <span className="font-mono text-sm text-stat-subtitle">{activeNodeName}</span>
        </div>

        {/* Right side: counts + last updated */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm text-stat-subtitle">
            <Activity className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
            <span className="font-mono tabular-nums">{stats.active}</span>
            <span>running</span>
          </div>
          {unreadAlerts > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-warning">
              <Bell className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="font-mono tabular-nums">{unreadAlerts}</span>
              <span>alert{unreadAlerts !== 1 ? 's' : ''}</span>
            </div>
          )}
          <div className="h-4 w-px bg-border" />
          <span className="text-xs text-stat-icon font-mono">
            {formatRelativeTime(lastUpdated)}
          </span>
        </div>
      </div>
    </Card>
  );
}
