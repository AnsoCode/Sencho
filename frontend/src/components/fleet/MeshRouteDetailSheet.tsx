import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, ServerCog, Hash } from 'lucide-react';
import type { MeshRouteDiagnostic, MeshActivityEvent, MeshProbeResult } from '@/types/mesh';
import { meshRouteStateFromBackend, meshRouteStateTokens } from './meshRouteState';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    alias: string | null;
}

export function MeshRouteDetailSheet({ open, onOpenChange, alias }: Props) {
    const [diag, setDiag] = useState<MeshRouteDiagnostic | null>(null);
    const [events, setEvents] = useState<MeshActivityEvent[]>([]);
    const [probe, setProbe] = useState<MeshProbeResult | null>(null);
    const [probing, setProbing] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || !alias) return;
        let cancelled = false;
        const refresh = async () => {
            setLoading(true);
            try {
                const [diagRes, evRes] = await Promise.all([
                    apiFetch(`/mesh/aliases/${encodeURIComponent(alias)}/diagnostic`, { localOnly: true }),
                    apiFetch(`/mesh/activity?alias=${encodeURIComponent(alias)}&limit=20`, { localOnly: true }),
                ]);
                if (cancelled) return;
                if (diagRes.ok) setDiag(await diagRes.json());
                if (evRes.ok) {
                    const body = await evRes.json() as { events: MeshActivityEvent[] };
                    setEvents(body.events);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void refresh();
        return () => { cancelled = true; };
    }, [open, alias]);

    const runProbe = async () => {
        if (!alias) return;
        setProbing(true);
        setProbe(null);
        try {
            const res = await apiFetch(`/mesh/aliases/${encodeURIComponent(alias)}/test`, {
                method: 'POST', localOnly: true,
            });
            const body = await res.json() as MeshProbeResult;
            setProbe(body);
        } finally {
            setProbing(false);
        }
    };

    if (!alias) return null;
    const pillState = diag ? meshRouteStateFromBackend(diag.state) : 'not-authorized';
    const pill = meshRouteStateTokens(pillState);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
                <SheetHeader>
                    <SheetTitle className="font-mono text-sm">{alias}</SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] leading-3 font-mono uppercase tracking-[0.18em] ${pill.toneClass}`}>
                            {pill.label}
                        </span>
                        {diag?.lastProbeMs != null && (
                            <span className="text-[11px] font-mono text-stat-subtitle">{diag.lastProbeMs}ms</span>
                        )}
                    </div>

                    {diag?.target && (
                        <div className="grid grid-cols-2 gap-2 rounded border border-card-border bg-card p-3 text-xs">
                            <div className="text-stat-subtitle">Target node</div>
                            <div className="font-mono text-stat-value">#{diag.target.nodeId}</div>
                            <div className="text-stat-subtitle">Stack / service</div>
                            <div className="font-mono text-stat-value">{diag.target.stack}/{diag.target.service}</div>
                            <div className="text-stat-subtitle">Port</div>
                            <div className="font-mono text-stat-value">{diag.target.port}</div>
                            <div className="text-stat-subtitle">Pilot tunnel</div>
                            <div className="font-mono text-stat-value">{diag.pilot.connected ? 'connected' : 'disconnected'}</div>
                        </div>
                    )}

                    {diag?.lastError && (
                        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-xs">
                            <div className="text-destructive font-mono uppercase tracking-[0.18em] leading-3 text-[10px] mb-1">last error</div>
                            <div className="text-stat-value">{diag.lastError.message}</div>
                            <div className="text-[10px] text-stat-subtitle mt-1">{new Date(diag.lastError.ts).toLocaleString()}</div>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => { void runProbe(); }} disabled={probing}>
                            {probing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Activity className="w-3 h-3 mr-1" />}
                            Test upstream
                        </Button>
                        {probe && (
                            <Badge variant={probe.ok ? 'default' : 'destructive'} className="text-[10px] font-mono">
                                {probe.ok ? `ok ${probe.latencyMs}ms` : `${probe.where ?? 'fail'}: ${probe.code ?? 'error'}`}
                            </Badge>
                        )}
                    </div>

                    <div>
                        <div className="text-[10px] leading-3 tracking-[0.18em] uppercase text-stat-subtitle font-mono mb-2">Recent activity</div>
                        <div className="space-y-1 max-h-72 overflow-auto">
                            {loading && <Loader2 className="w-4 h-4 animate-spin text-stat-subtitle" />}
                            {!loading && events.length === 0 && (
                                <div className="text-xs text-stat-subtitle">No events yet for this alias.</div>
                            )}
                            {events.map((e, i) => (
                                <div key={i} className="flex items-start gap-2 text-[11px] font-mono">
                                    {e.source === 'sidecar' && <ServerCog className="w-3 h-3 mt-0.5 text-stat-subtitle" />}
                                    {e.source === 'pilot' && <Hash className="w-3 h-3 mt-0.5 text-stat-subtitle" />}
                                    {e.source === 'mesh' && <Activity className="w-3 h-3 mt-0.5 text-stat-subtitle" />}
                                    <span className={`tabular-nums ${e.level === 'error' ? 'text-destructive' : e.level === 'warn' ? 'text-warning' : 'text-stat-value'}`}>
                                        {new Date(e.ts).toLocaleTimeString()} {e.type} {e.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
