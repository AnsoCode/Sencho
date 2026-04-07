import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Info, AlertTriangle, AlertOctagon, CheckCircle2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import type { NotificationItem } from './types';
import type { Node } from '@/context/NodeContext';

interface RecentAlertsProps {
  notifications: NotificationItem[];
  nodes?: Node[];
  onCleared?: () => void | Promise<void>;
}

const PAGE_SIZE = 8;

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

export function RecentAlerts({ notifications, nodes, onCleared }: RecentAlertsProps) {
  const [clearing, setClearing] = useState(false);
  const [page, setPage] = useState(0);

  const sorted = notifications
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedAlerts = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const needsPagination = sorted.length > PAGE_SIZE;

  const handleClearAll = async () => {
    setClearing(true);
    try {
      await onCleared?.();
      setPage(0);
    } catch (error) {
      toast.error((error as Error)?.message || 'Something went wrong.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-stat-title">Recent Alerts</CardTitle>
          {needsPagination && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
              <span className="text-xs font-mono tabular-nums text-stat-subtitle min-w-[3rem] text-center">
                {safePage + 1} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-stat-subtitle">
            <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={1.5} />
            <span className="text-sm">No recent alerts.</span>
          </div>
        ) : (
          <>
            <div className="space-y-0.5">
              {pagedAlerts.map(n => {
                const config = levelConfig[n.level] || levelConfig.info;
                const Icon = config.icon;
                return (
                  <div
                    key={n.id}
                    className="flex items-center gap-2.5 py-1.5 px-1 rounded-sm hover:bg-accent/5"
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${config.className}`} strokeWidth={1.5} />
                    {n.nodeName && nodes?.find(nd => nd.id === n.nodeId)?.type === 'remote' && (
                      <Badge variant="outline" className="text-[10px] font-normal shrink-0 py-0 px-1.5">
                        {n.nodeName}
                      </Badge>
                    )}
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
