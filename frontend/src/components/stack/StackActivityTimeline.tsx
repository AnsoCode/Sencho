import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Rocket, RefreshCcw, CircleStop, Play, ArrowUp, Activity, Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { formatTimeAgo } from '@/lib/relativeTime';
import type { NotificationItem } from '@/components/dashboard/types';

interface ActivityEvent {
  id: number;
  level: string;
  category?: string;
  message: string;
  timestamp: number;
  stack_name?: string;
  actor_username?: string | null;
}

interface StackActivityTimelineProps {
  stackName: string;
  liveEvents?: NotificationItem[];
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  deploy_success: Rocket,
  stack_restarted: RefreshCcw,
  stack_stopped: CircleStop,
  stack_started: Play,
  image_update_applied: ArrowUp,
};

const DAY_MS = 86_400_000;

function dayLabel(ts: number): 'Today' | 'Yesterday' | 'Earlier' {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  if (ts >= todayMs) return 'Today';
  if (ts >= todayMs - DAY_MS) return 'Yesterday';
  return 'Earlier';
}

function groupEvents(events: ActivityEvent[]): { label: string; events: ActivityEvent[] }[] {
  const groups: Record<string, ActivityEvent[]> = {};
  const order: string[] = [];
  for (const e of events) {
    const label = dayLabel(e.timestamp);
    if (!groups[label]) { groups[label] = []; order.push(label); }
    groups[label].push(e);
  }
  return order.map(label => ({ label, events: groups[label] }));
}

export function StackActivityTimeline({ stackName, liveEvents }: StackActivityTimelineProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const seenIdsRef = useRef(new Set<number>());

  const mergeEvents = useCallback((incoming: ActivityEvent[]) => {
    setEvents(prev => {
      const next = [...prev];
      let added = false;
      for (const e of incoming) {
        if (seenIdsRef.current.has(e.id)) continue;
        seenIdsRef.current.add(e.id);
        next.push(e);
        added = true;
      }
      if (!added) return prev;
      next.sort((a, b) => b.timestamp - a.timestamp);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    seenIdsRef.current = new Set();
    setEvents([]);
    setHasMore(true);

    apiFetch(`/stacks/${stackName}/activity?limit=50`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: { events: ActivityEvent[] }) => {
        if (cancelled) return;
        setHasMore(data.events.length === 50);
        data.events.forEach(e => seenIdsRef.current.add(e.id));
        setEvents(data.events);
      })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [stackName]);

  // liveEvents is pre-filtered by stack_name in the parent
  useEffect(() => {
    if (!liveEvents || liveEvents.length === 0) return;
    mergeEvents(liveEvents as ActivityEvent[]);
  }, [liveEvents, mergeEvents]);

  const loadMore = useCallback(async () => {
    const oldest = events[events.length - 1]?.timestamp;
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const r = await apiFetch(`/stacks/${stackName}/activity?limit=50&before=${oldest}`);
      if (!r.ok) return;
      const data: { events: ActivityEvent[] } = await r.json();
      setHasMore(data.events.length === 50);
      mergeEvents(data.events);
    } catch {
      toast.error('Failed to load more activity');
    } finally {
      setLoadingMore(false);
    }
  }, [events, stackName, mergeEvents]);

  const groups = useMemo(() => groupEvents(events), [events]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <Activity className="w-5 h-5 text-muted-foreground/40" />
        <span className="font-mono text-[11px] text-muted-foreground">No activity recorded yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-3">
      {groups.map(g => (
        <div key={g.label}>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-stat-subtitle mb-1.5 px-1">{g.label}</div>
          {g.events.map(e => {
            const Icon = CATEGORY_ICON[e.category ?? ''] ?? Activity;
            return (
              <div key={e.id} className="flex items-start gap-2 py-1.5 px-1 rounded-md hover:bg-glass-highlight/30 transition-colors">
                <Icon className="w-3 h-3 mt-0.5 shrink-0 text-brand/70" strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-[11px] text-foreground/90">{e.message}</span>
                  {e.actor_username && e.actor_username !== 'system' && (
                    <span className="ml-1.5 font-mono text-[10px] text-stat-subtitle">by {e.actor_username}</span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-stat-subtitle shrink-0">{formatTimeAgo(e.timestamp)}</span>
              </div>
            );
          })}
        </div>
      ))}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 font-mono text-[10px] text-muted-foreground"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Load more'}
        </Button>
      )}
    </div>
  );
}
