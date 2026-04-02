import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Server, Cpu, MemoryStick, HardDrive, RefreshCw, ChevronDown, ChevronRight,
    Layers, Wifi, WifiOff, Search, ArrowUpDown, AlertTriangle, Box, Activity,
    Play, Square, RotateCcw, ExternalLink, Camera,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '@/components/ui/tabs';
import { springs } from '@/lib/motion';
import { apiFetch } from '@/lib/api';
import { useLicense } from '@/context/LicenseContext';
import { ProGate } from './ProGate';
import FleetSnapshots from './FleetSnapshots';
import { toast } from '@/components/ui/toast-store';
import { LabelPill, LabelDot, type Label as StackLabel } from './LabelPill';

// --- Types ---

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

interface StackContainer {
    Id?: string;
    Names?: string[];
    Image?: string;
    State?: string;
    Status?: string;
}

type SortField = 'name' | 'cpu' | 'memory' | 'containers' | 'status';
type SortDir = 'asc' | 'desc';
type FilterStatus = 'all' | 'online' | 'offline';
type FilterType = 'all' | 'local' | 'remote';

interface FleetPreferences {
    sortBy: SortField;
    sortDir: SortDir;
    filterStatus: FilterStatus;
    filterType: FilterType;
    filterCritical: boolean;
}

const PREFS_KEY = 'sencho-fleet-preferences';

function loadPreferences(): FleetPreferences {
    try {
        const stored = localStorage.getItem(PREFS_KEY);
        if (stored) return JSON.parse(stored) as FleetPreferences;
    } catch { /* use defaults */ }
    return { sortBy: 'name', sortDir: 'asc', filterStatus: 'all', filterType: 'all', filterCritical: false };
}

function savePreferences(prefs: FleetPreferences) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// --- Utilities ---

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getNodeCpu(node: FleetNode): number {
    return node.systemStats ? parseFloat(node.systemStats.cpu.usage) : 0;
}

function getNodeMem(node: FleetNode): number {
    return node.systemStats ? parseFloat(node.systemStats.memory.usagePercent) : 0;
}

function getNodeDisk(node: FleetNode): number {
    return node.systemStats?.disk ? parseFloat(node.systemStats.disk.usagePercent) : 0;
}

function isCritical(node: FleetNode): boolean {
    return getNodeCpu(node) > 90 || getNodeDisk(node) > 90;
}

function containerName(c: StackContainer): string {
    if (c.Names && c.Names.length > 0) {
        return c.Names[0].replace(/^\//, '');
    }
    return c.Id?.slice(0, 12) ?? 'unknown';
}

// --- Sub-Components ---

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

function StatCard({ icon: Icon, label, value, sub, alert }: {
    icon: React.ElementType;
    label: string;
    value: string;
    sub?: string;
    alert?: boolean;
}) {
    return (
        <div className={`rounded-lg border bg-card p-4 ${alert ? 'border-red-500/30 bg-red-500/5' : ''}`}>
            <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${alert ? 'text-red-500' : 'text-stat-icon'}`} />
                <span className="text-xs text-stat-title">{label}</span>
            </div>
            <div className={`text-2xl font-medium tabular-nums tracking-tight ${alert ? 'text-destructive/70' : 'text-stat-value'}`}>{value}</div>
            {sub && <p className="text-xs text-stat-subtitle mt-1">{sub}</p>}
        </div>
    );
}

function ContainerRow({ container, nodeId, onNavigate }: {
    container: StackContainer;
    nodeId: number;
    onNavigate: (nodeId: number) => void;
}) {
    const name = containerName(container);
    const state = container.State?.toLowerCase() ?? 'unknown';
    const image = container.Image;
    const status = container.Status ?? '';

    const stateColor = state === 'running' ? 'bg-success' :
        state === 'restarting' ? 'bg-warning' : 'bg-red-500';

    return (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors group">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateColor}`} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{name}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0">{state}</Badge>
                </div>
                {(image || status) && (
                    <div className="flex items-center gap-2 mt-0.5">
                        {image && <span className="text-[10px] text-muted-foreground truncate">{image}</span>}
                        {status && <span className="text-[10px] text-muted-foreground shrink-0">{image ? '· ' : ''}{status}</span>}
                    </div>
                )}
            </div>
            <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onNavigate(nodeId)}
                title="Open in editor"
            >
                <ExternalLink className="w-3 h-3" />
            </Button>
        </div>
    );
}

function StackSection({ stackName, nodeId, onNavigate, labelMap }: {
    stackName: string;
    nodeId: number;
    onNavigate: (nodeId: number, stackName: string) => void;
    labelMap?: Record<string, StackLabel[]>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [containers, setContainers] = useState<StackContainer[] | null>(null);
    const [loading, setLoading] = useState(false);

    const handleExpand = async () => {
        const next = !expanded;
        setExpanded(next);

        if (next && containers === null) {
            setLoading(true);
            try {
                const res = await apiFetch(`/fleet/node/${nodeId}/stacks/${encodeURIComponent(stackName)}/containers`, { localOnly: true });
                if (res.ok) {
                    setContainers(await res.json());
                } else {
                    toast.error('Failed to load containers for ' + stackName);
                }
            } catch {
                toast.error('Failed to load containers for ' + stackName);
            } finally {
                setLoading(false);
            }
        }
    };

    const runningCount = containers?.filter(c => c.State?.toLowerCase() === 'running').length ?? 0;
    const totalCount = containers?.length ?? 0;

    return (
        <div>
            <button
                onClick={handleExpand}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs hover:bg-muted/50 transition-colors text-left group"
            >
                {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                <Layers className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{stackName}</span>
                {labelMap?.[stackName]?.length ? (
                    <span className="flex items-center gap-0.5 shrink-0">
                        {labelMap[stackName].map(l => (
                            <LabelDot key={l.id} color={l.color} />
                        ))}
                    </span>
                ) : null}
                {containers !== null && (
                    <span className="text-[10px] text-muted-foreground shrink-0">
                        {runningCount}/{totalCount}
                    </span>
                )}
            </button>
            {expanded && (
                <div className="ml-4 mt-1 space-y-0.5">
                    {loading ? (
                        <div className="space-y-2 px-3 py-1">
                            <Skeleton className="h-5 w-full" />
                            <Skeleton className="h-5 w-3/4" />
                        </div>
                    ) : containers && containers.length > 0 ? (
                        containers.map(c => (
                            <ContainerRow
                                key={c.Id ?? containerName(c)}
                                container={c}
                                nodeId={nodeId}
                                onNavigate={(nid) => onNavigate(nid, stackName)}
                            />
                        ))
                    ) : (
                        <p className="text-[10px] text-muted-foreground px-3 py-1">No containers</p>
                    )}
                </div>
            )}
        </div>
    );
}

function NodeCard({ node, onNavigate, labelMap }: { node: FleetNode; onNavigate: (nodeId: number, stackName: string) => void; labelMap?: Record<string, StackLabel[]> }) {
    const { isPro } = useLicense();
    const [expanded, setExpanded] = useState(false);
    const [stacks, setStacks] = useState<string[] | null>(node.stacks);
    const [loadingStacks, setLoadingStacks] = useState(false);

    const isOnline = node.status === 'online';
    const cpuPercent = getNodeCpu(node);
    const memPercent = getNodeMem(node);
    const diskPercent = getNodeDisk(node);

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
                } else {
                    toast.error('Failed to load stacks for ' + node.name);
                }
            } catch {
                toast.error('Failed to load stacks for ' + node.name);
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
                        <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${isOnline ? 'bg-success-muted' : 'bg-muted'}`}>
                            <Server className={`w-4 h-4 ${isOnline ? 'text-success' : 'text-muted-foreground'}`} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-medium truncate">{node.name}</h3>
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
                                {isOnline && isCritical(node) && (
                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Critical
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Container Stats */}
                {isOnline && node.stats && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-muted/50 rounded-lg px-2.5 py-2 text-center">
                            <div className="text-lg font-medium leading-none tabular-nums">{node.stats.active}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Running</div>
                        </div>
                        <div className="bg-muted/50 rounded-lg px-2.5 py-2 text-center">
                            <div className="text-lg font-medium leading-none tabular-nums">{node.stats.exited}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Stopped</div>
                        </div>
                        <div className="bg-muted/50 rounded-lg px-2.5 py-2 text-center">
                            <div className="text-lg font-medium leading-none tabular-nums">{node.stacks?.length ?? '-'}</div>
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
                            <UsageBar percent={cpuPercent} color={cpuPercent > 80 ? 'bg-red-500' : cpuPercent > 60 ? 'bg-warning' : 'bg-success'} />
                        </div>
                        <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <MemoryStick className="w-3 h-3" /> RAM
                                </span>
                                <span className="font-medium">{formatBytes(node.systemStats.memory.used)} / {formatBytes(node.systemStats.memory.total)}</span>
                            </div>
                            <UsageBar percent={memPercent} color={memPercent > 80 ? 'bg-red-500' : memPercent > 60 ? 'bg-warning' : 'bg-info'} />
                        </div>
                        {node.systemStats.disk && (
                            <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <HardDrive className="w-3 h-3" /> Disk
                                    </span>
                                    <span className="font-medium">{formatBytes(node.systemStats.disk.used)} / {formatBytes(node.systemStats.disk.total)}</span>
                                </div>
                                <UsageBar percent={diskPercent} color={diskPercent > 90 ? 'bg-red-500' : diskPercent > 75 ? 'bg-warning' : 'bg-violet-500'} />
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

            {/* Pro Expandable Stack List with Container Drill-Down */}
            {isOnline && isPro && (
                <div className="border-t">
                    <button
                        onClick={handleExpand}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
                    >
                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <Layers className="w-3.5 h-3.5" />
                        Stack details
                        {stacks !== null && (
                            <span className="ml-auto text-[10px]">{stacks.length} stacks</span>
                        )}
                    </button>
                    {expanded && (
                        <div className="px-2 pb-3">
                            {loadingStacks ? (
                                <div className="space-y-2 px-2">
                                    <Skeleton className="h-6 w-full" />
                                    <Skeleton className="h-6 w-3/4" />
                                </div>
                            ) : stacks && stacks.length > 0 ? (
                                <div className="space-y-0.5">
                                    {stacks.map(stack => (
                                        <StackSection
                                            key={stack}
                                            stackName={stack}
                                            nodeId={node.id}
                                            onNavigate={onNavigate}
                                            labelMap={labelMap}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground py-1 px-2">No stacks found</p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// --- Main Component ---

interface FleetViewProps {
    onNavigateToNode: (nodeId: number, stackName: string) => void;
}

export function FleetView({ onNavigateToNode }: FleetViewProps) {
    const [nodes, setNodes] = useState<FleetNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [prefs, setPrefs] = useState<FleetPreferences>(loadPreferences);
    const [fleetLabels, setFleetLabels] = useState<StackLabel[]>([]);
    const [fleetStackLabelMap, setFleetStackLabelMap] = useState<Record<string, StackLabel[]>>({});
    const [labelFilters, setLabelFilters] = useState<Set<number>>(new Set());
    const { isPro } = useLicense();

    const updatePrefs = useCallback((update: Partial<FleetPreferences>) => {
        setPrefs(prev => {
            const next = { ...prev, ...update };
            savePreferences(next);
            return next;
        });
    }, []);

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

    const fetchLabels = useCallback(async () => {
        if (!isPro) return;
        try {
            const [labelsRes, assignmentsRes] = await Promise.all([
                apiFetch('/labels', { localOnly: true }),
                apiFetch('/labels/assignments', { localOnly: true }),
            ]);
            if (labelsRes.ok) setFleetLabels(await labelsRes.json());
            if (assignmentsRes.ok) setFleetStackLabelMap(await assignmentsRes.json());
        } catch {
            // Non-critical
        }
    }, [isPro]);

    useEffect(() => {
        fetchOverview();
        fetchLabels();
    }, [fetchOverview, fetchLabels]);

    // Pro: auto-refresh every 30s
    useEffect(() => {
        if (!isPro) return;
        const interval = setInterval(() => fetchOverview(), 30000);
        return () => clearInterval(interval);
    }, [isPro, fetchOverview]);

    // --- Computed values ---

    const onlineNodes = useMemo(() => nodes.filter(n => n.status === 'online'), [nodes]);
    const onlineCount = onlineNodes.length;
    const totalContainers = nodes.reduce((sum, n) => sum + (n.stats?.active ?? 0), 0);
    const totalContainersAll = nodes.reduce((sum, n) => sum + (n.stats?.total ?? 0), 0);
    const totalStacks = nodes.reduce((sum, n) => sum + (n.stacks?.length ?? 0), 0);
    const criticalCount = onlineNodes.filter(isCritical).length;

    const avgCpu = onlineNodes.length > 0
        ? (onlineNodes.reduce((sum, n) => sum + getNodeCpu(n), 0) / onlineNodes.length).toFixed(1)
        : '0';
    const worstCpuNode = onlineNodes.length > 0
        ? onlineNodes.reduce((worst, n) => getNodeCpu(n) > getNodeCpu(worst) ? n : worst, onlineNodes[0])
        : null;

    const totalMemUsed = onlineNodes.reduce((sum, n) => sum + (n.systemStats?.memory.used ?? 0), 0);
    const totalMemTotal = onlineNodes.reduce((sum, n) => sum + (n.systemStats?.memory.total ?? 0), 0);

    // --- Filtering & Sorting (Pro) ---

    const processedNodes = useMemo(() => {
        let filtered = [...nodes];

        // Search (Pro only, but harmless if applied - free users won't see the search bar)
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(n =>
                n.name.toLowerCase().includes(q) ||
                n.stacks?.some(s => s.toLowerCase().includes(q))
            );
        }

        if (isPro) {
            // Status filter
            if (prefs.filterStatus === 'online') filtered = filtered.filter(n => n.status === 'online');
            if (prefs.filterStatus === 'offline') filtered = filtered.filter(n => n.status !== 'online');

            // Type filter
            if (prefs.filterType === 'local') filtered = filtered.filter(n => n.type === 'local');
            if (prefs.filterType === 'remote') filtered = filtered.filter(n => n.type === 'remote');

            // Critical filter
            if (prefs.filterCritical) filtered = filtered.filter(isCritical);

            // Label filter
            if (labelFilters.size > 0) {
                filtered = filtered.filter(n =>
                    n.stacks?.some(s => {
                        const sLabels = fleetStackLabelMap[s] || [];
                        return sLabels.some(l => labelFilters.has(l.id));
                    })
                );
            }

            // Sort
            filtered.sort((a, b) => {
                let cmp = 0;
                switch (prefs.sortBy) {
                    case 'name':
                        cmp = a.name.localeCompare(b.name);
                        break;
                    case 'cpu':
                        cmp = getNodeCpu(b) - getNodeCpu(a);
                        break;
                    case 'memory':
                        cmp = getNodeMem(b) - getNodeMem(a);
                        break;
                    case 'containers':
                        cmp = (b.stats?.active ?? 0) - (a.stats?.active ?? 0);
                        break;
                    case 'status':
                        cmp = (a.status === 'online' ? 0 : 1) - (b.status === 'online' ? 0 : 1);
                        break;
                }
                return prefs.sortDir === 'desc' ? -cmp : cmp;
            });
        }

        return filtered;
    }, [nodes, searchQuery, isPro, prefs, labelFilters, fleetStackLabelMap]);

    return (
        <div className="h-full overflow-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-medium tracking-tight">Fleet Overview</h1>
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

            <Tabs defaultValue="overview">
                <TabsList>
                    <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                        <TabsHighlightItem value="overview">
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                        </TabsHighlightItem>
                        {isPro && (
                            <TabsHighlightItem value="snapshots">
                                <TabsTrigger value="snapshots">
                                    <Camera className="w-4 h-4 mr-1.5" />Snapshots
                                </TabsTrigger>
                            </TabsHighlightItem>
                        )}
                    </TabsHighlight>
                </TabsList>

                <TabsContent value="overview">
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

                    {/* Fleet Content */}
                    {!loading && nodes.length > 0 && (
                        <>
                            {/* Pro: Fleet Health Summary Cards */}
                            {isPro && onlineNodes.length > 0 && (
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                                    <StatCard
                                        icon={Box}
                                        label="Containers"
                                        value={`${totalContainers}`}
                                        sub={`${totalContainersAll} total across fleet`}
                                    />
                                    <StatCard
                                        icon={Activity}
                                        label="Fleet CPU"
                                        value={`${avgCpu}%`}
                                        sub={worstCpuNode ? `Peak: ${worstCpuNode.name} (${worstCpuNode.systemStats?.cpu.usage}%)` : undefined}
                                    />
                                    <StatCard
                                        icon={MemoryStick}
                                        label="Fleet Memory"
                                        value={formatBytes(totalMemUsed)}
                                        sub={totalMemTotal > 0 ? `of ${formatBytes(totalMemTotal)} (${((totalMemUsed / totalMemTotal) * 100).toFixed(0)}%)` : undefined}
                                    />
                                    <StatCard
                                        icon={AlertTriangle}
                                        label="Alerts"
                                        value={`${criticalCount}`}
                                        sub={criticalCount > 0 ? `${criticalCount} node${criticalCount > 1 ? 's' : ''} above 90% CPU or disk` : 'All nodes healthy'}
                                        alert={criticalCount > 0}
                                    />
                                </div>
                            )}

                            {/* Pro: Search, Sort & Filter Toolbar */}
                            {isPro && (
                                <div className="flex flex-wrap items-center gap-3 mb-4">
                                    {/* Search */}
                                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                                        <Input
                                            placeholder="Search nodes or stacks..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="pl-9 h-9"
                                        />
                                    </div>

                                    {/* Sort */}
                                    <Select value={prefs.sortBy} onValueChange={(v) => updatePrefs({ sortBy: v as SortField })}>
                                        <SelectTrigger className="w-[150px] h-9">
                                            <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="name">Name</SelectItem>
                                            <SelectItem value="cpu">CPU Usage</SelectItem>
                                            <SelectItem value="memory">Memory Usage</SelectItem>
                                            <SelectItem value="containers">Containers</SelectItem>
                                            <SelectItem value="status">Status</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 w-9 p-0"
                                        onClick={() => updatePrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
                                        title={prefs.sortDir === 'asc' ? 'Ascending' : 'Descending'}
                                    >
                                        <ArrowUpDown className={`w-4 h-4 ${prefs.sortDir === 'desc' ? 'rotate-180' : ''} transition-transform`} />
                                    </Button>

                                    {/* Filter pills */}
                                    <div className="flex items-center gap-1.5">
                                        {(['all', 'online', 'offline'] as FilterStatus[]).map(status => (
                                            <Button
                                                key={status}
                                                variant={prefs.filterStatus === status ? 'default' : 'outline'}
                                                size="sm"
                                                className="h-7 text-xs px-2.5"
                                                onClick={() => updatePrefs({ filterStatus: status })}
                                            >
                                                {status === 'all' ? 'All' : status === 'online' ? (
                                                    <><Play className="w-3 h-3 mr-1" />Online</>
                                                ) : (
                                                    <><Square className="w-3 h-3 mr-1" />Offline</>
                                                )}
                                            </Button>
                                        ))}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {(['all', 'local', 'remote'] as FilterType[]).map(type => (
                                            <Button
                                                key={type}
                                                variant={prefs.filterType === type ? 'default' : 'outline'}
                                                size="sm"
                                                className="h-7 text-xs px-2.5"
                                                onClick={() => updatePrefs({ filterType: type })}
                                            >
                                                {type === 'all' ? 'All Types' : type.charAt(0).toUpperCase() + type.slice(1)}
                                            </Button>
                                        ))}
                                    </div>

                                    <Button
                                        variant={prefs.filterCritical ? 'destructive' : 'outline'}
                                        size="sm"
                                        className="h-7 text-xs px-2.5"
                                        onClick={() => updatePrefs({ filterCritical: !prefs.filterCritical })}
                                    >
                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                        Critical Only
                                    </Button>

                                    {fleetLabels.length > 0 && (
                                        <>
                                            <div className="w-px h-5 bg-border mx-1" />
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {fleetLabels.map(label => (
                                                    <LabelPill
                                                        key={label.id}
                                                        label={label}
                                                        size="sm"
                                                        active={labelFilters.has(label.id)}
                                                        onClick={() => {
                                                            setLabelFilters(prev => {
                                                                const next = new Set(prev);
                                                                if (next.has(label.id)) next.delete(label.id);
                                                                else next.add(label.id);
                                                                return next;
                                                            });
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Node Grid */}
                            {processedNodes.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {processedNodes.map(node => (
                                        <NodeCard
                                            key={node.id}
                                            node={node}
                                            onNavigate={onNavigateToNode}
                                            labelMap={fleetStackLabelMap}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <Search className="w-10 h-10 text-muted-foreground/50 mb-3" />
                                    <h3 className="text-sm font-medium mb-1">No nodes match your filters</h3>
                                    <p className="text-xs text-muted-foreground">Try adjusting your search or filter criteria.</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-3"
                                        onClick={() => {
                                            setSearchQuery('');
                                            updatePrefs({ filterStatus: 'all', filterType: 'all', filterCritical: false });
                                            setLabelFilters(new Set());
                                        }}
                                    >
                                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                        Clear filters
                                    </Button>
                                </div>
                            )}

                            {/* Pro auto-refresh indicator */}
                            {isPro && (
                                <p className="text-xs text-muted-foreground text-center mt-6">
                                    Auto-refreshing every 30 seconds
                                </p>
                            )}

                            {/* Free tier: Pro gate for advanced features */}
                            {!isPro && nodes.length > 0 && (
                                <div className="mt-6">
                                    <ProGate featureName="Fleet Management">
                                        {/* Preview of what Pro unlocks */}
                                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                                            <div className="rounded-xl border bg-card p-4 h-24" />
                                            <div className="rounded-xl border bg-card p-4 h-24" />
                                            <div className="rounded-xl border bg-card p-4 h-24" />
                                            <div className="rounded-xl border bg-card p-4 h-24" />
                                        </div>
                                        <div className="flex gap-3 mb-4">
                                            <div className="h-9 rounded-md border bg-card flex-1 max-w-sm" />
                                            <div className="h-9 rounded-md border bg-card w-[150px]" />
                                        </div>
                                    </ProGate>
                                </div>
                            )}
                        </>
                    )}
                </TabsContent>

                {isPro && (
                    <TabsContent value="snapshots">
                        <FleetSnapshots />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
