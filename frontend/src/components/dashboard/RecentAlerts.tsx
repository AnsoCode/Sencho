import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info, AlertTriangle, AlertOctagon, CheckCircle2, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import type { NotificationItem } from './types';

interface RecentAlertsProps {
  notifications: NotificationItem[];
  onCleared?: () => void;
  maxItems?: number;
}

const levelConfig: Record<string, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-info' },
  warning: { icon: AlertTriangle, className: 'text-warning' },
  error: { icon: AlertOctagon, className: 'text-destructive' },
};

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function RecentAlerts({ notifications, onCleared, maxItems = 8 }: RecentAlertsProps) {
  const [clearing, setClearing] = useState(false);
  const recent = notifications
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxItems);

  const handleClearAll = async () => {
    setClearing(true);
    try {
      const res = await apiFetch('/notifications', { method: 'DELETE', localOnly: true });
      if (!res.ok) throw new Error('Failed to clear notifications');
      onCleared?.();
    } catch (error) {
      toast.error((error as Error)?.message || 'Something went wrong.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-stat-title">Recent Alerts</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {recent.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-stat-subtitle">
            <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.5} />
            <span className="text-sm">No recent alerts.</span>
          </div>
        ) : (
          <>
            <div className="space-y-0.5">
              {recent.map(n => {
                const config = levelConfig[n.level] || levelConfig.info;
                const Icon = config.icon;
                return (
                  <div
                    key={n.id}
                    className="flex items-center gap-2.5 py-1.5 px-1 rounded-sm hover:bg-accent/5"
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${config.className}`} strokeWidth={1.5} />
                    <span className={`text-xs flex-1 truncate ${n.is_read ? 'text-stat-subtitle' : 'text-stat-value'}`}>
                      {n.message}
                    </span>
                    <span className="text-xs font-mono tabular-nums text-stat-icon shrink-0">
                      {formatRelativeTime(n.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                disabled={clearing}
                onClick={handleClearAll}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                {clearing ? 'Clearing...' : 'Clear All Notifications'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
