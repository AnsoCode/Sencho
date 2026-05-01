import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ServerCog } from 'lucide-react';
import type { MeshNodeDiagnostic } from '@/types/mesh';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    nodeId: number | null;
    nodeName: string | null;
}

function bytesFmt(n: number): string {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function ageFmt(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    return `${Math.floor(ms / 60_000)}m`;
}

export function MeshDiagnosticsSheet({ open, onOpenChange, nodeId, nodeName }: Props) {
    const [diag, setDiag] = useState<MeshNodeDiagnostic | null>(null);
    const [loading, setLoading] = useState(false);
    const [restarting, setRestarting] = useState(false);

    const refresh = async () => {
        if (nodeId == null) return;
        setLoading(true);
        try {
            const res = await apiFetch(`/mesh/nodes/${nodeId}/diagnostic`, { localOnly: true });
            if (res.ok) setDiag(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, nodeId]);

    const restart = async () => {
        if (nodeId == null) return;
        setRestarting(true);
        try {
            const res = await apiFetch(`/mesh/nodes/${nodeId}/sidecar/restart`, {
                method: 'POST', localOnly: true,
            });
            if (res.ok) {
                toast.success('Sidecar restart requested');
                await refresh();
            } else {
                toast.error('Sidecar restart failed');
            }
        } finally {
            setRestarting(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-[520px] sm:max-w-[520px]">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <ServerCog className="w-4 h-4" /> Diagnostics{nodeName ? ` · ${nodeName}` : ''}
                    </SheetTitle>
                </SheetHeader>

                <div className="mt-4 space-y-4">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => { void refresh(); }} disabled={loading}>
                            {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                            Refresh
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => { void restart(); }} disabled={restarting}>
                            {restarting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                            Restart sidecar
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded border border-card-border bg-card p-3 text-xs">
                        <div className="text-stat-subtitle">Sidecar</div>
                        <div className="font-mono text-stat-value">{diag?.sidecar.running ? 'running' : 'off'}</div>
                        <div className="text-stat-subtitle">Pilot tunnel</div>
                        <div className="font-mono text-stat-value">{diag?.pilot.connected ? 'connected' : 'disconnected'}</div>
                        <div className="text-stat-subtitle">Buffered</div>
                        <div className="font-mono text-stat-value">{diag ? bytesFmt(diag.pilot.bufferedAmount) : '-'}</div>
                        <div className="text-stat-subtitle">Last seen</div>
                        <div className="font-mono text-stat-value">{diag?.pilot.lastSeen ? new Date(diag.pilot.lastSeen).toLocaleTimeString() : '-'}</div>
                    </div>

                    <div>
                        <div className="text-[10px] tracking-[0.18em] uppercase text-stat-subtitle font-mono mb-2">Active streams</div>
                        {(!diag || diag.activeStreams.length === 0) && (
                            <div className="text-xs text-stat-subtitle">No active streams.</div>
                        )}
                        <div className="space-y-1">
                            {diag?.activeStreams.map((s) => (
                                <div key={s.streamId} className="flex justify-between rounded border border-card-border bg-card px-2 py-1 text-[11px] font-mono">
                                    <span>#{s.streamId} {s.alias ?? '<no-alias>'}</span>
                                    <span className="text-stat-subtitle">in {bytesFmt(s.bytesIn)} / out {bytesFmt(s.bytesOut)} · {ageFmt(s.ageMs)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] tracking-[0.18em] uppercase text-stat-subtitle font-mono mb-2">Resolver cache</div>
                        {(!diag || diag.aliasCache.length === 0) && (
                            <div className="text-xs text-stat-subtitle">No aliases registered.</div>
                        )}
                        <div className="space-y-1">
                            {diag?.aliasCache.map((a) => (
                                <div key={a.host} className="flex justify-between rounded border border-card-border bg-card px-2 py-1 text-[11px] font-mono">
                                    <span>{a.host}</span>
                                    <span className="text-stat-subtitle">node #{a.targetNodeId}:{a.port}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
