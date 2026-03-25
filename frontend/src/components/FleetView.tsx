import { useState, useEffect, useCallback } from 'react';
import { Server, Cpu, MemoryStick, HardDrive, Container, RefreshCw, ChevronDown, ChevronRight, Layers, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api';
import { useLicense } from '@/context/LicenseContext';
import { ProGate } from './ProGate';

interface FleetNodeStats {
    active: number;
    managed: number;
    unmanaged: number;
    exited: number;
    total: number;
}

interface FleetNodeSystemStats {
    cpu: { usage: string; cores: number };
    memory: { total: number; used: number; free: number; usagePercent: string };
    disk: { total: number; used: number; free: number; usagePercent: string } | null;
}

interface FleetNode {
    id: number;
    name: string;
    type: 'local' | 'remote';
    status: 'online' | 'offline' | 'unknown';
    stats: FleetNodeStats | null;
    systemStats: FleetNodeSystemStats | null;
    stacks: string[] | null;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function UsageBar({ percent, color }: { percent: number; color: string }) {
    return (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
                className={`h-full rounded-full transition-all duration-500 ${color}`}
                style={{ width: `${Math.min(100, percent)}%` }}
            />
        </div>
    );
}

function NodeCard({ node, onNavigate }: { node: FleetNode; onNavigate: (nodeId: number) => void }) {
    const { isPro } = useLicense();
    const [expanded, setExpanded] = useState(false);
    const [stacks, setStacks] = useState<string[] | null>(node.stacks);
    const [loadingStacks, setLoadingStacks] = useState(false);

    const isOnline = node.status === 'online';
    const cpuPercent = node.systemStats ? parseFloat(node.systemStats.cpu.usage) : 0;
    const memPercent = node.systemStats ? parseFloat(node.systemStats.memory.usagePercent) : 0;
    const diskPercent = node.systemStats?.disk ? parseFloat(node.systemStats.disk.usagePercent) : 0;

    const handleExpand = async () => {
        if (!isPro) return;
        const next = !expanded;
        setExpanded(next);

        if (next && !stacks) {
            setLoadingStacks(true);
            try {
                const res = await apiFetch(`/fleet/node/${node.id}/stacks`, { localOnly: true });
                if (res.ok) {
                    setStacks(await res.json());
                }
            } catch {
                // silently fail
            } finally {
                setLoadingStacks(false);
            }
        }
    };

    return (
        <div className={`rounded-xl border bg-card text-card-foreground transition-all ${isOnline ? '' : 'opacity-60'}`}>
            {/* Card Header */}
            <div className="p-4 pb-3">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${isOnline ? 'bg-emerald-500/10' : 'bg-muted'}`}>
                            <Server className={`w-4 h-4 ${isOnline ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold truncate">{node.name}</h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <Badge variant={isOnline ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 h-4">
                                    {isOnline ? (
                                        <><Wifi className="w-2.5 h-2.5 mr-0.5" /> Online</>
                                    ) : (
                                        <><WifiOff className="w-2.5 h-2.5 mr-0.5" /> Offline</>
                                    )}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                    {node.type}
                                </Badge>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Container Stats */}
                {isOnline && node.stats && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-muted/50 rounded-lg px-2.5 py-2 text-center">
                            <div className="text-lg font-bold leading-none">{node.stats.active}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Running</div>
                        </div>
                        <div className="bg-muted/50 rounded-lg px-2.5 py-2 text-center">
                            <div className="text-lg font-bold leading-none">{node.stats.exited}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Stopped</div>
                        </div>
                        <div className="bg-muted/50 rounded-lg px-2.5 py-2 text-center">
                            <div className="text-lg font-bold leading-none">{node.stacks?.length ?? '—'}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Stacks</div>
                        </div>
                    </div>
                )}

                {/* Resource Usage Bars */}
                {isOnline && node.systemStats && (
                    <div className="space-y-2">
                        <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <Cpu className="w-3 h-3" /> CPU
                                </span>
                                <span className="font-medium">{node.systemStats.cpu.usage}%</span>
                            </div>
                            <UsageBar percent={cpuPercent} color={cpuPercent > 80 ? 'bg-red-500' : cpuPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'} />
                        </div>
                        <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <MemoryStick className="w-3 h-3" /> RAM
                                </span>
                                <span className="font-medium">{formatBytes(node.systemStats.memory.used)} / {formatBytes(node.systemStats.memory.total)}</span>
                            </div>
                            <UsageBar percent={memPercent} color={memPercent > 80 ? 'bg-red-500' : memPercent > 60 ? 'bg-amber-500' : 'bg-blue-500'} />
                        </div>
                        {node.systemStats.disk && (
                            <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <HardDrive className="w-3 h-3" /> Disk
                                    </span>
                                    <span className="font-medium">{formatBytes(node.systemStats.disk.used)} / {formatBytes(node.systemStats.disk.total)}</span>
                                </div>
                                <UsageBar percent={diskPercent} color={diskPercent > 90 ? 'bg-red-500' : diskPercent > 75 ? 'bg-amber-500' : 'bg-violet-500'} />
                            </div>
                        )}
                    </div>
                )}

                {/* Offline placeholder */}
                {!isOnline && (
                    <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                        Node unreachable
                    </div>
                )}
            </div>

            {/* Pro Expandable Stack List */}
            {isOnline && isPro && (
                <div className="border-t">
                    <button
                        onClick={handleExpand}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <Layers className="w-3.5 h-3.5" />
                        Stack details
                    </button>
                    {expanded && (
                        <div className="px-4 pb-3">
                            {loadingStacks ? (
                                <div className="space-y-2">
                                    <Skeleton className="h-6 w-full" />
                                    <Skeleton className="h-6 w-3/4" />
                                </div>
                            ) : stacks && stacks.length > 0 ? (
                                <div className="space-y-1">
                                    {stacks.map(stack => (
                                        <button
                                            key={stack}
                                            onClick={() => onNavigate(node.id)}
                                            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs hover:bg-muted transition-colors text-left"
                                        >
                                            <Container className="w-3 h-3 text-muted-foreground shrink-0" />
                                            <span className="truncate">{stack}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground py-1">No stacks found</p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

interface FleetViewProps {
    onNavigateToNode: (nodeId: number) => void;
}

export function FleetView({ onNavigateToNode }: FleetViewProps) {
    const [nodes, setNodes] = useState<FleetNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { isPro } = useLicense();

    const fetchOverview = useCallback(async (showRefresh = false) => {
        if (showRefresh) setRefreshing(true);
        try {
            const res = await apiFetch('/fleet/overview', { localOnly: true });
            if (res.ok) {
                setNodes(await res.json());
            }
        } catch (error) {
            console.error('Failed to fetch fleet overview:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);

    // Pro: auto-refresh every 30s
    useEffect(() => {
        if (!isPro) return;
        const interval = setInterval(() => fetchOverview(), 30000);
        return () => clearInterval(interval);
    }, [isPro, fetchOverview]);

    const onlineCount = nodes.filter(n => n.status === 'online').length;
    const totalContainers = nodes.reduce((sum, n) => sum + (n.stats?.active ?? 0), 0);
    const totalStacks = nodes.reduce((sum, n) => sum + (n.stacks?.length ?? 0), 0);

    return (
        <div className="h-full overflow-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Fleet Overview</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {loading ? 'Loading...' : `${onlineCount} of ${nodes.length} nodes online · ${totalContainers} containers · ${totalStacks} stacks`}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchOverview(true)}
                    disabled={refreshing}
                    className="gap-2"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            {/* Loading State */}
            {loading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
                            <Skeleton className="h-8 w-32" />
                            <div className="grid grid-cols-3 gap-2">
                                <Skeleton className="h-14 rounded-lg" />
                                <Skeleton className="h-14 rounded-lg" />
                                <Skeleton className="h-14 rounded-lg" />
                            </div>
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-3/4" />
                        </div>
                    ))}
                </div>
            )}

            {/* Empty State */}
            {!loading && nodes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Server className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium mb-1">No nodes configured</h3>
                    <p className="text-sm text-muted-foreground">Add nodes in Settings to see your fleet here.</p>
                </div>
            )}

            {/* Node Grid */}
            {!loading && nodes.length > 0 && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {nodes.map(node => (
                            <NodeCard
                                key={node.id}
                                node={node}
                                onNavigate={onNavigateToNode}
                            />
                        ))}
                    </div>

                    {/* Pro auto-refresh indicator */}
                    {isPro && (
                        <p className="text-xs text-muted-foreground text-center mt-6">
                            Auto-refreshing every 30 seconds
                        </p>
                    )}

                    {/* Free tier upgrade prompt for advanced features */}
                    {!isPro && nodes.length > 0 && (
                        <div className="mt-6">
                            <ProGate featureName="Fleet Management">
                                <></>
                            </ProGate>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
