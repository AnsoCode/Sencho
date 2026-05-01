import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Activity, AlertOctagon, AlertTriangle, Cloud, RefreshCw,
  RotateCcw, Search, ServerCrash, CheckCircle2, Info,
} from 'lucide-react';
import { useRecentActivity } from './useRecentActivity';

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

type IconType = typeof Activity;

const CATEGORY_ICONS: Record<string, { icon: IconType; className: string }> = {
  deploy_failure: { icon: ServerCrash, className: 'text-destructive' },
  deploy_success: { icon: CheckCircle2, className: 'text-success' },
  image_update_applied: { icon: RefreshCw, className: 'text-brand' },
  image_update_available: { icon: RefreshCw, className: 'text-warning' },
  auto_heal_restarted: { icon: RotateCcw, className: 'text-brand' },
  auto_heal_failed: { icon: AlertOctagon, className: 'text-destructive' },
  auto_heal_policy_disabled: { icon: AlertTriangle, className: 'text-warning' },
  scan_finding: { icon: Search, className: 'text-warning' },
  cloud_backup_success: { icon: Cloud, className: 'text-success' },
  cloud_backup_failed: { icon: Cloud, className: 'text-destructive' },
};

const LEVEL_ICONS: Record<string, { icon: IconType; className: string }> = {
  info: { icon: Info, className: 'text-stat-subtitle' },
  warning: { icon: AlertTriangle, className: 'text-warning' },
  error: { icon: AlertOctagon, className: 'text-destructive' },
};

export function RecentActivity() {
  const { items, loading } = useRecentActivity(10);

  if (loading) {
    return (
      <Card className="bg-card shadow-card-bevel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-stat-title">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 py-1.5 px-1">
              <div className="h-3.5 w-3.5 rounded-full bg-accent/10 animate-pulse shrink-0" />
              <div className="h-3 flex-1 rounded-sm bg-accent/10 animate-pulse" />
              <div className="h-3 w-8 rounded-sm bg-accent/10 animate-pulse shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card shadow-card-bevel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-stat-title">Recent Activity</CardTitle>
          <Activity className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-stat-subtitle">
            <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.5} />
            <span className="text-sm">No recent activity.</span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map(item => {
              const categoryConfig = item.category ? CATEGORY_ICONS[item.category] : null;
              const levelConfig = LEVEL_ICONS[item.level] ?? LEVEL_ICONS.info;
              const { icon: Icon, className } = categoryConfig ?? levelConfig;
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 py-1.5 px-1 rounded-sm hover:bg-accent/5"
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${className}`}
                    strokeWidth={1.5}
                  />
                  <span className={`text-xs flex-1 leading-relaxed ${item.is_read ? 'text-stat-subtitle' : 'text-stat-value'}`}>
                    {item.message}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-stat-icon shrink-0 mt-0.5">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
