import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/relativeTime';
import type { NotificationItem } from '@/components/dashboard/types';

const ONE_HOUR_S = 60 * 60;
const NOW_TICK_MS = 30_000;

interface SidebarActivityTickerProps {
  notifications: NotificationItem[];
  connected: boolean;
  onNavigate: () => void;
}

export function SidebarActivityTicker({ notifications, connected, onNavigate }: SidebarActivityTickerProps) {
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);
  const latest = useMemo(() => {
    return notifications
      .filter(n => n.stack_name && nowS - n.timestamp <= ONE_HOUR_S)
      .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
  }, [notifications, nowS]);

  const idle = latest === null;
  const dotClass = connected
    ? 'bg-success shadow-[0_0_6px_var(--success)] animate-pulse'
    : 'bg-warning';
  const kicker = idle ? 'IDLE · NO RECENT ACTIVITY' : 'LIVE · VIEW ACTIVITY →';

  return (
    <button
      type="button"
      onClick={onNavigate}
      className={cn(
        'w-full flex flex-col gap-0.5 px-4 py-2 border-t border-glass-border',
        'bg-sidebar/80 hover:bg-glass-highlight text-left',
      )}
    >
      <div className="flex items-center gap-2">
        <span data-testid="ticker-dot" className={cn('w-1.5 h-1.5 rounded-full', dotClass)} />
        {idle ? (
          <span className="font-mono text-[11px] text-muted-foreground">No recent activity</span>
        ) : (
          <span className="font-mono text-[11px] truncate">
            <span className="text-brand">{latest.stack_name}</span>
            <span className="text-muted-foreground"> · {latest.message} · {formatTimeAgo(latest.timestamp * 1000)}</span>
          </span>
        )}
      </div>
      <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-stat-subtitle pl-3.5">
        {kicker}
      </span>
    </button>
  );
}
