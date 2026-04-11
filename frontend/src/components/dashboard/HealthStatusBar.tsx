import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Activity, Bell } from 'lucide-react';
import {
  CursorProvider,
  Cursor,
  CursorContainer,
  CursorFollow,
} from '@/components/animate-ui/primitives/animate/cursor';
import type { Stats, SystemStats, NotificationItem, HealthLevel } from './types';

interface HealthStatusBarProps {
  stats: Stats;
  systemStats: SystemStats | null;
  notifications: NotificationItem[];
  activeNodeName: string;
}

interface HealthResult {
  level: HealthLevel;
  reasons: string[];
}

function deriveHealth(stats: Stats, systemStats: SystemStats | null, notifications: NotificationItem[]): HealthResult {
  const cpu = parseFloat(systemStats?.cpu.usage || '0');
  const ram = parseFloat(systemStats?.memory.usagePercent || '0');
  const disk = parseFloat(systemStats?.disk?.usagePercent || '0');
  const unreadErrors = notifications.filter(n => !n.is_read && n.level === 'error').length;

  const reasons: string[] = [];

  if (cpu >= 90) reasons.push(`CPU at ${cpu.toFixed(1)}%`);
  else if (cpu >= 80) reasons.push(`CPU at ${cpu.toFixed(1)}%`);

  if (ram >= 90) reasons.push(`RAM at ${ram.toFixed(1)}%`);
  else if (ram >= 80) reasons.push(`RAM at ${ram.toFixed(1)}%`);

  if (disk >= 90) reasons.push(`Disk at ${disk.toFixed(1)}%`);
  else if (disk >= 80) reasons.push(`Disk at ${disk.toFixed(1)}%`);

  if (stats.exited > 0 && unreadErrors > 0) reasons.push(`${stats.exited} exited container${stats.exited !== 1 ? 's' : ''}`);
  else if (unreadErrors > 0) reasons.push(`${unreadErrors} unread error${unreadErrors !== 1 ? 's' : ''}`);

  if (cpu >= 90 || ram >= 90 || disk >= 90 || (stats.exited > 0 && unreadErrors > 0)) {
    return { level: 'critical', reasons };
  }
  if (cpu >= 80 || ram >= 80 || disk >= 80 || unreadErrors > 0) {
    return { level: 'degraded', reasons };
  }
  return { level: 'healthy', reasons: ['All systems nominal'] };
}

const healthConfig: Record<HealthLevel, { label: string; dotClass: string; textClass: string }> = {
  healthy: { label: 'Healthy', dotClass: 'bg-success', textClass: 'text-success' },
  degraded: { label: 'Degraded', dotClass: 'bg-warning animate-pulse', textClass: 'text-warning' },
  critical: { label: 'Critical', dotClass: 'bg-destructive animate-pulse', textClass: 'text-destructive' },
};

export function HealthStatusBar({ stats, systemStats, notifications, activeNodeName }: HealthStatusBarProps) {
  const { level, reasons } = useMemo(
    () => deriveHealth(stats, systemStats, notifications),
    [stats, systemStats, notifications]
  );
  const config = healthConfig[level];
  const unreadAlerts = notifications.filter(n => !n.is_read).length;

  return (
    <Card className="bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Health badge */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <CursorProvider>
              <CursorContainer className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
                <span className={`font-mono text-sm font-medium ${config.textClass}`}>
                  {config.label}
                </span>
              </CursorContainer>
              <Cursor>
                <div className={`h-2 w-2 rounded-full ${level === 'healthy' ? 'bg-brand' : level === 'degraded' ? 'bg-warning' : 'bg-destructive'}`} />
              </Cursor>
              <CursorFollow
                side="bottom"
                sideOffset={4}
                align="center"
                transition={{ stiffness: 400, damping: 40, bounce: 0 }}
              >
                <div className="rounded-md border border-card-border bg-popover/95 backdrop-blur-[10px] backdrop-saturate-[1.15] px-2.5 py-1.5 shadow-md">
                  <div className="flex flex-col gap-0.5 font-mono text-xs tabular-nums">
                    {reasons.map((reason) => (
                      <span key={reason} className="text-stat-value whitespace-nowrap">{reason}</span>
                    ))}
                  </div>
                </div>
              </CursorFollow>
            </CursorProvider>
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
        </div>
      </div>
    </Card>
  );
}
