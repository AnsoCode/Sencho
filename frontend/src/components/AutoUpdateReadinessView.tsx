import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RefreshCw, Shield, AlertTriangle, ShieldAlert, Clock, Play, CalendarClock } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { PaidGate } from '@/components/PaidGate';
import { useNodes } from '@/context/NodeContext';
import type { ScheduledTask } from '@/types/scheduling';

type SemverBump = 'none' | 'patch' | 'minor' | 'major' | 'unknown';

interface UpdatePreviewImage {
  service: string;
  image: string;
  current_tag: string;
  next_tag: string | null;
  has_update: boolean;
  semver_bump: SemverBump;
}

type UpdateKind = 'tag' | 'digest' | 'none';

interface UpdatePreview {
  stack_name: string;
  images: UpdatePreviewImage[];
  summary: {
    has_update: boolean;
    primary_image: string | null;
    current_tag: string | null;
    next_tag: string | null;
    semver_bump: SemverBump;
    update_kind: UpdateKind;
    blocked: boolean;
    blocked_reason: string | null;
  };
  rollback_target: string | null;
  changelog: string | null;
}

interface StackCard {
  stack: string;
  preview: UpdatePreview | null;
  previewLoaded: boolean;
  scheduledTask: ScheduledTask | null;
  applying: boolean;
}

function formatRelative(ts: number | null): string {
  if (ts == null) return '';
  const delta = ts - Date.now();
  if (delta <= 0) return 'due now';
  const mins = Math.round(delta / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `in ${days}d ${remHours}h` : `in ${days}d`;
}

function formatClock(ts: number | null): string {
  if (ts == null) return '';
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RiskBadge({ bump, blocked }: { bump: SemverBump; blocked: boolean }) {
  if (blocked || bump === 'major') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-destructive">
        <ShieldAlert className="h-3 w-3" strokeWidth={1.5} />
        Blocked · major
      </span>
    );
  }
  if (bump === 'minor') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
        Review · minor
      </span>
    );
  }
  if (bump === 'patch') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
        <Shield className="h-3 w-3" strokeWidth={1.5} />
        Safe · patch
      </span>
    );
  }
  if (bump === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-muted/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-stat-subtitle">
        Digest rebuild
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-muted/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-stat-subtitle">
      None
    </span>
  );
}

function VersionDiff({ current, next }: { current: string | null; next: string | null }) {
  if (!current) return null;
  const changed = next && next !== current;
  return (
    <div className="flex items-baseline gap-2 font-mono text-sm">
      <span className="text-stat-subtitle">{current}</span>
      <span className="text-stat-subtitle/60">→</span>
      <span className={changed ? 'text-brand font-medium' : 'text-stat-subtitle'}>
        {next ?? current}
      </span>
    </div>
  );
}

function StackReadinessCard({
  card,
  onApply,
}: {
  card: StackCard;
  onApply: (stack: string) => void;
}) {
  const { stack, preview, previewLoaded, scheduledTask, applying } = card;
  const loading = !previewLoaded;
  const failed = previewLoaded && preview === null;
  const blocked = preview?.summary.blocked ?? false;
  const bump = preview?.summary.semver_bump ?? 'none';
  const updatingImageCount = preview?.images.filter(i => i.has_update).length ?? 0;
  const nextRun = scheduledTask?.next_run_at ?? null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle/80">
            Stack
          </span>
          <span className="font-display italic text-2xl leading-tight tracking-tight text-stat-value truncate">
            {stack}
          </span>
        </div>
        {previewLoaded && preview && <RiskBadge bump={bump} blocked={blocked} />}
      </div>

      {loading ? (
        <div className="font-mono text-xs text-stat-subtitle/80">Checking registry...</div>
      ) : failed ? (
        <div className="font-mono text-xs text-destructive/80">
          Preview failed. Registry may be unreachable.
        </div>
      ) : (
        (() => {
          const p = preview!;
          const blockedReason = p.summary.blocked_reason;
          return (
            <>
              {p.summary.update_kind === 'digest' ? (
                <div className="flex items-baseline gap-2 font-mono text-sm">
                  <span className="text-stat-subtitle">{p.summary.current_tag}</span>
                  <span className="text-brand text-[11px] uppercase tracking-[0.16em]">
                    Rebuild available
                  </span>
                </div>
              ) : (
                <VersionDiff
                  current={p.summary.current_tag}
                  next={p.summary.next_tag}
                />
              )}

              <div className="flex items-center gap-1.5 font-mono text-[11px] text-stat-subtitle/80">
                <span>{p.summary.primary_image ?? '-'}</span>
                {updatingImageCount > 1 && (
                  <span className="text-stat-subtitle/60">
                    · {updatingImageCount} services
                  </span>
                )}
              </div>

              <div className="border-t border-dashed border-card-border pt-3 text-xs text-stat-subtitle/90 leading-relaxed">
                {p.changelog ?? 'No changelog available from the registry yet.'}
              </div>

              {blocked && blockedReason && (
                <div className="rounded border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive/90">
                  {blockedReason}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-stat-subtitle">
                  {nextRun ? (
                    <>
                      <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      <span>Scheduled · <span className="text-stat-value">{formatClock(nextRun)}</span></span>
                      <span className="text-stat-subtitle/70">· {formatRelative(nextRun)}</span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                      <span>No schedule</span>
                    </>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => onApply(stack)}
                  disabled={blocked || applying}
                  title={blocked ? (blockedReason ?? undefined) : undefined}
                  className="gap-1.5"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                  {applying ? 'Applying...' : 'Apply now'}
                </Button>
              </div>
            </>
          );
        })()
      )}
    </Card>
  );
}

function ReadinessHero({
  total,
  ready,
  refreshing,
  onRefresh,
}: {
  total: number;
  ready: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const headline = total === 0
    ? 'Everything is up to date'
    : total === 1
      ? '1 update pending'
      : `${total} updates pending`;

  return (
    <div className="relative overflow-hidden rounded-lg border border-brand/25 border-t-brand/35 bg-card shadow-card-bevel">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand/[0.10] via-brand/[0.02] to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
      <div className="relative grid grid-cols-[1fr_auto] items-center gap-6 py-5 pl-7 pr-6">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-brand">
            Fleet readiness
          </span>
          <span className="font-display italic text-3xl leading-tight tracking-tight text-stat-value">
            {headline}
          </span>
          {total > 0 && (
            <span className="font-mono text-[11px] text-stat-subtitle/90">
              {ready} of {total} ready to apply automatically
              {total - ready > 0 ? ` · ${total - ready} blocked by major bump` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && (
            <div className="text-right">
              <div className="font-mono tabular-nums text-2xl text-stat-value">
                {ready}<span className="text-stat-subtitle/60"> / {total}</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
                Ready
              </div>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Recheck registries"
            className="gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              strokeWidth={1.5}
              aria-hidden="true"
            />
            Recheck
          </Button>
        </div>
      </div>
    </div>
  );
}

function AutoUpdateReadinessContent() {
  const { activeNode } = useNodes();
  const [cards, setCards] = useState<StackCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic token guards against stale setCards from older node-scoped fetches.
  const loadTokenRef = useRef(0);

  const loadReadiness = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const currentNodeId = activeNode?.id ?? null;
    setLoading(true);
    try {
      const [statusRes, tasksRes] = await Promise.all([
        apiFetch('/image-updates'),
        apiFetch('/scheduled-tasks?action=update', { localOnly: true }),
      ]);
      if (token !== loadTokenRef.current) return;

      if (!statusRes.ok) {
        throw new Error('Failed to load image update status');
      }
      const statuses = await statusRes.json() as Record<string, boolean>;
      const stacksWithUpdates = Object.entries(statuses)
        .filter(([, hasUpdate]) => hasUpdate)
        .map(([stack]) => stack)
        .sort();

      const tasks: ScheduledTask[] = tasksRes.ok ? await tasksRes.json() : [];
      const taskByStack = new Map<string, ScheduledTask>();
      for (const t of tasks) {
        // Match tasks targeting this stack on this node. Tasks with node_id=null
        // are local-node-scoped and only apply when viewing the local node.
        const matchesNode = currentNodeId != null
          ? (t.node_id === currentNodeId || (t.node_id == null && activeNode?.type === 'local'))
          : t.node_id == null;
        if (t.target_type === 'stack' && t.target_id && matchesNode) {
          const existing = taskByStack.get(t.target_id);
          if (!existing || (t.next_run_at ?? Infinity) < (existing.next_run_at ?? Infinity)) {
            taskByStack.set(t.target_id, t);
          }
        }
      }

      const initial: StackCard[] = stacksWithUpdates.map(stack => ({
        stack,
        preview: null,
        previewLoaded: false,
        scheduledTask: taskByStack.get(stack) ?? null,
        applying: false,
      }));
      if (token !== loadTokenRef.current) return;
      setCards(initial);

      const previews = await Promise.all(
        stacksWithUpdates.map(async (stack) => {
          try {
            const res = await apiFetch(`/stacks/${encodeURIComponent(stack)}/update-preview`);
            if (!res.ok) return null;
            return await res.json() as UpdatePreview;
          } catch {
            return null;
          }
        }),
      );
      if (token !== loadTokenRef.current) return;

      setCards(stacksWithUpdates.map((stack, idx) => ({
        stack,
        preview: previews[idx],
        previewLoaded: true,
        scheduledTask: taskByStack.get(stack) ?? null,
        applying: false,
      })));
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      toast.error((err as Error)?.message || 'Failed to load readiness');
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [activeNode?.id, activeNode?.type]);

  useEffect(() => {
    loadReadiness();
    return () => {
      // Invalidate any in-flight fetch and cancel pending refresh timers on unmount/node-change.
      loadTokenRef.current++;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [loadReadiness]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await apiFetch('/image-updates/refresh', { method: 'POST' });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({ error: 'Rate limited' }));
        toast.warning(data.error ?? 'Please wait before rechecking');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to trigger refresh');
        return;
      }
      toast.success('Checking registries for updates...');
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        loadReadiness();
      }, 2500);
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to trigger refresh');
    } finally {
      setRefreshing(false);
    }
  }, [loadReadiness]);

  const handleApply = useCallback(async (stack: string) => {
    setCards(prev => prev.map(c => c.stack === stack ? { ...c, applying: true } : c));
    const loadingId = toast.loading(`Applying update to ${stack}...`);
    try {
      const res = await apiFetch(`/stacks/${encodeURIComponent(stack)}/update`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Update failed' }));
        throw new Error(data.error ?? 'Update failed');
      }
      toast.success(`${stack} updated successfully`);
      setCards(prev => prev.filter(c => c.stack !== stack));
    } catch (err) {
      toast.error((err as Error)?.message || 'Update failed');
      setCards(prev => prev.map(c => c.stack === stack ? { ...c, applying: false } : c));
    } finally {
      toast.dismiss(loadingId);
    }
  }, []);

  const { total, ready } = useMemo(() => {
    const t = cards.length;
    const r = cards.filter(c => c.previewLoaded && c.preview !== null && !c.preview.summary.blocked).length;
    return { total: t, ready: r };
  }, [cards]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1600px] mx-auto w-full">
      <ReadinessHero total={total} ready={ready} refreshing={refreshing} onRefresh={handleRefresh} />

      {loading && cards.length === 0 ? (
        <div className="flex items-center justify-center py-16 font-mono text-xs text-stat-subtitle">
          Loading readiness...
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-card-border bg-card/40 py-16">
          <Shield className="h-8 w-8 text-success/70" strokeWidth={1.5} aria-hidden="true" />
          <div className="font-display italic text-xl text-stat-value">All stacks on current builds</div>
          <div className="font-mono text-[11px] text-stat-subtitle">
            Sencho will recheck registries on the scheduler interval.
          </div>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
          {cards.map(card => (
            <StackReadinessCard key={card.stack} card={card} onApply={handleApply} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AutoUpdateReadinessView() {
  return (
    <PaidGate featureName="Auto-Update Readiness">
      <AutoUpdateReadinessContent />
    </PaidGate>
  );
}
