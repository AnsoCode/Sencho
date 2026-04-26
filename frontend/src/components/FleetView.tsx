import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Server, Cpu, MemoryStick, HardDrive, RefreshCw, ChevronDown, ChevronRight,
    Layers, Wifi, WifiOff, Search, ArrowUpDown, AlertTriangle,
    Play, Square, RotateCcw, ExternalLink, Camera, Download, Loader2, Check,
    CircleCheck, CircleAlert, Globe, Monitor, X, LayoutGrid, Network, SlidersHorizontal,
} from 'lucide-react';
import { FleetMasthead } from './fleet/FleetMasthead';
import { FleetTopology } from './fleet/FleetTopology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '@/components/ui/tabs';
import { springs } from '@/lib/motion';
import { apiFetch, fetchForNode } from '@/lib/api';
import { useLicense } from '@/context/LicenseContext';
import { PaidGate } from './PaidGate';
import FleetSnapshots from './FleetSnapshots';
import { FleetConfiguration } from './fleet/FleetConfiguration';
import { toast } from '@/components/ui/toast-store';
import { LabelDot } from './LabelPill';
import { type Label as StackLabel, type LabelColor } from './label-types';

interface FleetPaletteEntry {
    key: string;
    name: string;
    color: LabelColor;
}

function labelPaletteKey(name: string, color: LabelColor): string {
    return `${name.trim().toLowerCase()}|${color}`;
}

const FILTER_SECTION_LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground';
import { MultiSelectCombobox } from '@/components/ui/multi-select-combobox';
import { formatVersion } from '@/lib/version';
import { CursorProvider, Cursor, CursorFollow, CursorContainer } from '@/components/animate-ui/primitives/animate/cursor';

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

interface NodeUpdateStatus {
    nodeId: number;
    name: string;
    type: 'local' | 'remote';
    version: string | null;
    latestVersion: string | null;
    updateAvailable: boolean;
    updateStatus: 'updating' | 'completed' | 'timeout' | 'failed' | null;
    error?: string | null;
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
        state === 'restarting' ? 'bg-warning' : 'bg-destructive';

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
                <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
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
        if (loading) return;
        const next = !expanded;
        setExpanded(next);

        if (next) {
            setLoading(true);
            try {
                const res = await apiFetch(`/fleet/node/${nodeId}/stacks/${encodeURIComponent(stackName)}/containers`, { localOnly: true });
                if (res.ok) {
                    setContainers(await res.json());
                } else {
                    toast.error('Failed to load containers for ' + stackName);
                }
            } catch (error) {
                console.error('Failed to load containers for', stackName, error);
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

function UpdateStatusBadge({ status, error, onRetry, onDismiss }: {
    status: NodeUpdateStatus['updateStatus'];
    error?: string | null;
    onRetry?: () => void;
    onDismiss?: () => void;
}) {
    if (status === 'updating') return (
        <Badge className="text-[10px] px-1.5 py-0 h-4 bg-info/15 text-info border-info/30 shrink-0">
            <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" /> Updating
        </Badge>
    );
    if (status === 'completed') return (
        <Badge className="text-[10px] px-1.5 py-0 h-4 bg-success-muted text-success border-success/30 shrink-0">
            <Check className="w-2.5 h-2.5 mr-0.5" /> Updated
        </Badge>
    );
    if (status === 'timeout' || status === 'failed') {
        const label = status === 'timeout' ? 'Timed out' : 'Failed';
        return (
            <CursorProvider>
                <CursorContainer className="flex items-center gap-1">
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 shrink-0">{label}</Badge>
                    {onRetry && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onRetry(); }}
                            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Retry update"
                        >
                            <RotateCcw className="w-3 h-3" strokeWidth={1.5} />
                        </button>
                    )}
                    {onDismiss && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Dismiss"
                        >
                            <X className="w-3 h-3" strokeWidth={1.5} />
                        </button>
                    )}
                    {error && (
                        <>
                            <Cursor>
                                <div className="h-2 w-2 rounded-full bg-destructive/60" />
                            </Cursor>
                            <CursorFollow side="bottom" sideOffset={8} align="end" alignOffset={0}>
                                <div className="bg-popover/95 backdrop-blur-[10px] backdrop-saturate-[1.15] border border-card-border shadow-md rounded-lg px-3 py-2 max-w-xs">
                                    <p className="font-mono tabular-nums text-xs text-stat-subtitle">{error}</p>
                                </div>
                            </CursorFollow>
                        </>
                    )}
                </CursorContainer>
            </CursorProvider>
        );
    }
    return null;
}

interface ReconnectingOverlayProps {
    /** Gateway boot timestamp captured pre-update. Null falls back to offline-then-online detection. */
    preUpdateStartedAt: number | null;
}

function ReconnectingOverlay({ preUpdateStartedAt }: ReconnectingOverlayProps) {
    const [elapsed, setElapsed] = useState(0);
    const timedOut = elapsed >= 300; // 5 minutes

    useEffect(() => {
        const timer = setInterval(() => setElapsed(s => s + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (timedOut) return;
        let sawOffline = false;
        const poll = setInterval(async () => {
            try {
                const res = await fetch('/api/health');
                if (!res.ok) {
                    sawOffline = true;
                    return;
                }
                const data = await res.json().catch(() => null) as { startedAt?: number } | null;
                const currentStartedAt = typeof data?.startedAt === 'number' ? data.startedAt : null;

                if (preUpdateStartedAt !== null && currentStartedAt !== null) {
                    if (currentStartedAt !== preUpdateStartedAt) {
                        window.location.reload();
                    }
                    return;
                }

                // Fallback when we don't know the original startedAt: require an offline
                // response first so we don't reload while the old process is still mid-pull.
                if (sawOffline) {
                    window.location.reload();
                }
            } catch {
                sawOffline = true;
            }
        }, 3000);
        return () => clearInterval(poll);
    }, [timedOut, preUpdateStartedAt]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-[10px] backdrop-saturate-[1.15]">
            <div className="text-center space-y-4">
                {timedOut ? (
                    <>
                        <AlertTriangle className="w-10 h-10 text-warning mx-auto" strokeWidth={1.5} />
                        <h2 className="text-lg font-medium">Update timed out</h2>
                        <p className="text-sm text-muted-foreground max-w-sm">
                            The server has not come back within 5 minutes. Check the Docker host directly.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                            Try Reloading
                        </Button>
                    </>
                ) : (
                    <>
                        <Loader2 className="w-10 h-10 text-muted-foreground animate-spin mx-auto" strokeWidth={1.5} />
                        <h2 className="text-lg font-medium">Updating Sencho...</h2>
                        <p className="text-sm text-muted-foreground max-w-sm">
                            The server is pulling the latest image and restarting. This page will reload automatically.
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">{elapsed}s elapsed</p>
                    </>
                )}
            </div>
        </div>
    );
}

interface NodeCardProps {
    node: FleetNode;
    onNavigate: (nodeId: number, stackName: string) => void;
    labelMap?: Record<string, StackLabel[]>;
    updateStatus?: NodeUpdateStatus;
    onUpdate?: (nodeId: number) => void;
    updatingNodeId?: number | null;
    onRetryUpdate?: (nodeId: number) => void;
    onDismissUpdate?: (nodeId: number) => void;
}

function NodeCard({ node, onNavigate, labelMap, updateStatus, onUpdate, updatingNodeId, onRetryUpdate, onDismissUpdate }: NodeCardProps) {
    const { isPaid } = useLicense();
    const [expanded, setExpanded] = useState(false);
    const [stacks, setStacks] = useState<string[] | null>(node.stacks);
    const [loadingStacks, setLoadingStacks] = useState(false);

    const isOnline = node.status === 'online';
    const isLocal = node.type === 'local';
    const formattedVersion = formatVersion(updateStatus?.version);
    const formattedLatest = formatVersion(updateStatus?.latestVersion);
    const cpuPercent = getNodeCpu(node);
    const memPercent = getNodeMem(node);
    const diskPercent = getNodeDisk(node);

    const handleExpand = async () => {
        if (!isPaid) return;
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
            } catch (error) {
                console.error('Failed to load stacks for', node.name, error);
                toast.error('Failed to load stacks for ' + node.name);
            } finally {
                setLoadingStacks(false);
            }
        }
    };

    const localRailClasses = isLocal
        ? 'relative overflow-hidden ring-1 ring-brand/30 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-brand before:rounded-l-xl after:pointer-events-none after:absolute after:inset-0 after:bg-gradient-to-r after:from-brand/[0.06] after:via-transparent after:to-transparent'
        : '';

    return (
        <div className={`rounded-xl border border-card-border border-t-card-border-top bg-card text-card-foreground shadow-card-bevel transition-colors hover:border-t-card-border-hover ${localRailClasses} ${isOnline ? '' : 'opacity-60'}`}>
            {/* Card Header */}
            <div className="relative p-4 pb-3">
                {isLocal && (
                    <span className="absolute top-3 right-3 font-mono text-[9px] uppercase tracking-[0.22em] text-brand">
                        ★ Local
                    </span>
                )}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${isOnline ? 'bg-success-muted' : 'bg-muted'}`}>
                            <Server className={`w-4 h-4 ${isOnline ? 'text-success' : 'text-muted-foreground'}`} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm font-medium truncate">{node.name}</h3>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <Badge variant={isOnline ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                                    {isOnline ? (
                                        <><Wifi className="w-2.5 h-2.5 mr-0.5" /> Online</>
                                    ) : (
                                        <><WifiOff className="w-2.5 h-2.5 mr-0.5" /> Offline</>
                                    )}
                                </Badge>
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                                    {node.type}
                                </Badge>
                                {formattedVersion && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono tabular-nums shrink-0">
                                        {formattedVersion}
                                    </Badge>
                                )}
                                {updateStatus?.updateStatus && (
                                    <UpdateStatusBadge
                                        status={updateStatus.updateStatus}
                                        error={updateStatus.error}
                                        onRetry={onRetryUpdate ? () => onRetryUpdate(node.id) : undefined}
                                        onDismiss={onDismissUpdate ? () => onDismissUpdate(node.id) : undefined}
                                    />
                                )}
                                {updateStatus?.updateAvailable && !updateStatus.updateStatus && (
                                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-warning/15 text-warning border-warning/30 shrink-0">
                                        Update available
                                    </Badge>
                                )}
                                {isOnline && isCritical(node) && (
                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
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
                            <UsageBar percent={cpuPercent} color={cpuPercent > 80 ? 'bg-destructive/80' : cpuPercent > 60 ? 'bg-warning' : 'bg-success'} />
                        </div>
                        <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                                <span className="flex items-center gap-1 text-muted-foreground">
                                    <MemoryStick className="w-3 h-3" /> RAM
                                </span>
                                <span className="font-medium">{formatBytes(node.systemStats.memory.used)} / {formatBytes(node.systemStats.memory.total)}</span>
                            </div>
                            <UsageBar percent={memPercent} color={memPercent > 80 ? 'bg-destructive/80' : memPercent > 60 ? 'bg-warning' : 'bg-info'} />
                        </div>
                        {node.systemStats.disk && (
                            <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="flex items-center gap-1 text-muted-foreground">
                                        <HardDrive className="w-3 h-3" /> Disk
                                    </span>
                                    <span className="font-medium">{formatBytes(node.systemStats.disk.used)} / {formatBytes(node.systemStats.disk.total)}</span>
                                </div>
                                <UsageBar percent={diskPercent} color={diskPercent > 90 ? 'bg-destructive/80' : diskPercent > 75 ? 'bg-warning' : 'bg-brand'} />
                            </div>
                        )}
                    </div>
                )}

                {/* Update button */}
                {isOnline && updateStatus?.updateAvailable && !updateStatus.updateStatus && onUpdate && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full h-7 text-xs"
                            onClick={() => onUpdate(node.id)}
                            disabled={updatingNodeId === node.id}
                        >
                            {updatingNodeId === node.id ? (
                                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Triggering...</>
                            ) : (
                                <><Download className="w-3 h-3 mr-1.5" strokeWidth={1.5} />{formattedLatest ? `Update to ${formattedLatest}` : 'Update'}</>
                            )}
                        </Button>
                    </div>
                )}

                {/* Offline placeholder */}
                {!isOnline && (
                    <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                        Node unreachable
                    </div>
                )}
            </div>

            {/* Paid: Expandable Stack List with Container Drill-Down */}
            {isOnline && isPaid && (
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
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'topology'>('grid');
    const [prefs, setPrefs] = useState<FleetPreferences>(loadPreferences);
    const [fleetPalette, setFleetPalette] = useState<FleetPaletteEntry[]>([]);
    const [fleetStackLabelMap, setFleetStackLabelMap] = useState<Record<number, Record<string, StackLabel[]>>>({});
    const [labelFilters, setLabelFilters] = useState<Set<string>>(new Set());
    const { isPaid } = useLicense();
    const [updateStatuses, setUpdateStatuses] = useState<NodeUpdateStatus[]>([]);
    const [updatingNodeId, setUpdatingNodeId] = useState<number | null>(null);
    const [reconnecting, setReconnecting] = useState(false);
    const [preUpdateStartedAt, setPreUpdateStartedAt] = useState<number | null>(null);
    const [localUpdateConfirm, setLocalUpdateConfirm] = useState<number | null>(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [checkingUpdates, setCheckingUpdates] = useState(false);
    const [recheckingUpdates, setRecheckingUpdates] = useState(false);
    const [modalSearch, setModalSearch] = useState('');
    const updateStatusesRef = useRef(updateStatuses);
    updateStatusesRef.current = updateStatuses;

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
                setLastSyncAt(Date.now());
            }
        } catch (error) {
            console.error('Failed to fetch fleet overview:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    const fetchLabelsForNodes = useCallback(async (fleetNodes: FleetNode[]) => {
        if (!isPaid || fleetNodes.length === 0) return;

        const paletteMap = new Map<string, FleetPaletteEntry>();
        const stackLabelMap: Record<number, Record<string, StackLabel[]>> = {};

        await Promise.allSettled(fleetNodes.map(async (node) => {
            if (node.status !== 'online') return;
            try {
                const [labelsRes, assignmentsRes] = await Promise.all([
                    fetchForNode('/labels', node.id, { signal: AbortSignal.timeout(5000) }),
                    fetchForNode('/labels/assignments', node.id, { signal: AbortSignal.timeout(5000) }),
                ]);
                if (labelsRes.ok) {
                    const labels = await labelsRes.json() as StackLabel[];
                    for (const l of labels) {
                        const key = labelPaletteKey(l.name, l.color);
                        if (!paletteMap.has(key)) {
                            paletteMap.set(key, { key, name: l.name, color: l.color });
                        }
                    }
                }
                if (assignmentsRes.ok) {
                    stackLabelMap[node.id] = await assignmentsRes.json() as Record<string, StackLabel[]>;
                }
            } catch {
                // Node unreachable or slow: skip, other nodes still contribute.
            }
        }));

        setFleetPalette(Array.from(paletteMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
        setFleetStackLabelMap(stackLabelMap);
    }, [isPaid]);

    const fetchUpdateStatus = useCallback(async () => {
        if (!isPaid) return;
        try {
            const res = await apiFetch('/fleet/update-status', { localOnly: true });
            if (res.ok) {
                const data = await res.json();
                const next: NodeUpdateStatus[] = data.nodes ?? [];
                setUpdateStatuses(prev =>
                    JSON.stringify(prev) === JSON.stringify(next) ? prev : next
                );
            }
        } catch { /* non-critical */ }
    }, [isPaid]);

    const triggerNodeUpdate = useCallback(async (nodeId: number) => {
        const status = updateStatusesRef.current.find(s => s.nodeId === nodeId);
        if (status?.type === 'local') {
            setLocalUpdateConfirm(nodeId);
            return;
        }

        setUpdatingNodeId(nodeId);
        try {
            const res = await apiFetch(`/fleet/nodes/${nodeId}/update`, { method: 'POST', localOnly: true });
            if (res.ok) {
                toast.success(`Update initiated on ${status?.name ?? 'node'}.`);
                fetchUpdateStatus();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.message || err?.error || err?.data?.error || 'Failed to trigger update.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Something went wrong.');
        } finally {
            setUpdatingNodeId(null);
        }
    }, [fetchUpdateStatus]);

    const confirmLocalUpdate = useCallback(async () => {
        const nodeId = localUpdateConfirm;
        setLocalUpdateConfirm(null);
        if (!nodeId) return;

        setUpdatingNodeId(nodeId);
        try {
            // Capture pre-update boot timestamp so the overlay can detect a real restart
            // vs a false "online" response from the still-running old process mid-pull.
            let bootBefore: number | null = null;
            try {
                const healthRes = await fetch('/api/health');
                if (healthRes.ok) {
                    const data = await healthRes.json();
                    if (typeof data?.startedAt === 'number') bootBefore = data.startedAt;
                }
            } catch { /* fall back to offline-then-online detection */ }

            const res = await apiFetch(`/fleet/nodes/${nodeId}/update`, { method: 'POST', localOnly: true });
            if (res.ok) {
                setPreUpdateStartedAt(bootBefore);
                setReconnecting(true);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.message || err?.error || err?.data?.error || 'Failed to trigger local update.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Something went wrong.');
        } finally {
            setUpdatingNodeId(null);
        }
    }, [localUpdateConfirm]);

    const triggerUpdateAll = useCallback(async () => {
        try {
            const res = await apiFetch('/fleet/update-all', { method: 'POST', localOnly: true });
            if (res.ok) {
                const data = await res.json();
                if (data.updating?.length > 0) {
                    toast.success(`Update initiated on ${data.updating.length} node${data.updating.length > 1 ? 's' : ''}.`);
                } else {
                    toast.success('All nodes are up to date.');
                }
                fetchUpdateStatus();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.message || err?.error || err?.data?.error || 'Failed to trigger fleet update.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Something went wrong.');
        }
    }, [fetchUpdateStatus]);

    const dismissNodeUpdate = useCallback(async (nodeId: number) => {
        try {
            await apiFetch(`/fleet/nodes/${nodeId}/update-status`, { method: 'DELETE', localOnly: true });
            fetchUpdateStatus();
        } catch (error) {
            console.error('[Fleet] Failed to dismiss update status:', error);
        }
    }, [fetchUpdateStatus]);

    const retryNodeUpdate = useCallback(async (nodeId: number) => {
        triggerNodeUpdate(nodeId);
    }, [triggerNodeUpdate]);

    useEffect(() => {
        fetchOverview();
        fetchUpdateStatus();
    }, [fetchOverview, fetchUpdateStatus]);

    // Refetch labels only when the set of online nodes actually changes,
    // not on every `fetchOverview` tick (which mints a new `nodes` ref).
    const onlineNodeKey = nodes
        .filter(n => n.status === 'online')
        .map(n => n.id)
        .sort((a, b) => a - b)
        .join(',');
    useEffect(() => {
        if (!isPaid || nodes.length === 0) return;
        fetchLabelsForNodes(nodes);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPaid, onlineNodeKey, fetchLabelsForNodes]);

    // Paid tier: auto-refresh every 30s
    useEffect(() => {
        if (!isPaid) return;
        const overviewInterval = setInterval(fetchOverview, 30000);
        const updateInterval = setInterval(fetchUpdateStatus, 120000);
        return () => { clearInterval(overviewInterval); clearInterval(updateInterval); };
    }, [isPaid, fetchOverview, fetchUpdateStatus]);

    // Fast poll (5s) when any node is actively updating. Uses ref to avoid interval thrashing.
    const hasUpdatingRef = useRef(false);
    useEffect(() => {
        hasUpdatingRef.current = updateStatuses.some(s => s.updateStatus === 'updating');
    }, [updateStatuses]);

    useEffect(() => {
        const id = setInterval(() => {
            if (hasUpdatingRef.current) {
                fetchUpdateStatus();
                fetchOverview();
            }
        }, 5000);
        return () => clearInterval(id);
    }, [fetchUpdateStatus, fetchOverview]);

    // --- Computed values ---

    const onlineNodes = useMemo(() => nodes.filter(n => n.status === 'online'), [nodes]);
    const onlineCount = onlineNodes.length;
    const totalContainers = nodes.reduce((sum, n) => sum + (n.stats?.active ?? 0), 0);
    const totalContainersAll = nodes.reduce((sum, n) => sum + (n.stats?.total ?? 0), 0);
    const criticalCount = onlineNodes.filter(isCritical).length;

    const avgCpuNum = onlineNodes.length > 0
        ? onlineNodes.reduce((sum, n) => sum + getNodeCpu(n), 0) / onlineNodes.length
        : 0;
    const worstCpuNode = onlineNodes.length > 0
        ? onlineNodes.reduce((worst, n) => getNodeCpu(n) > getNodeCpu(worst) ? n : worst, onlineNodes[0])
        : null;
    const worstCpu = worstCpuNode
        ? { name: worstCpuNode.name, percent: getNodeCpu(worstCpuNode) }
        : null;

    const totalMemUsed = onlineNodes.reduce((sum, n) => sum + (n.systemStats?.memory.used ?? 0), 0);
    const totalMemTotal = onlineNodes.reduce((sum, n) => sum + (n.systemStats?.memory.total ?? 0), 0);


    const updatableRemoteCount = useMemo(
        () => updateStatuses.filter(s => s.updateAvailable && !s.updateStatus && s.type === 'remote').length,
        [updateStatuses]
    );

    const updateStatusMap = useMemo(
        () => new Map(updateStatuses.map(s => [s.nodeId, s])),
        [updateStatuses]
    );

    // --- Filtering & Sorting (Skipper+) ---

    const processedNodes = useMemo(() => {
        let filtered = [...nodes];

        // Search (paid only, but harmless if applied - free users won't see the search bar)
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(n =>
                n.name.toLowerCase().includes(q) ||
                n.stacks?.some(s => s.toLowerCase().includes(q))
            );
        }

        if (isPaid) {
            // Status filter
            if (prefs.filterStatus === 'online') filtered = filtered.filter(n => n.status === 'online');
            if (prefs.filterStatus === 'offline') filtered = filtered.filter(n => n.status !== 'online');

            // Type filter
            if (prefs.filterType === 'local') filtered = filtered.filter(n => n.type === 'local');
            if (prefs.filterType === 'remote') filtered = filtered.filter(n => n.type === 'remote');

            // Critical filter
            if (prefs.filterCritical) filtered = filtered.filter(isCritical);

            // Label filter: match by (name, color) palette key so equivalent
            // labels across nodes behave as one filter.
            if (labelFilters.size > 0) {
                filtered = filtered.filter(n => {
                    const nodeStackLabels = fleetStackLabelMap[n.id] ?? {};
                    return n.stacks?.some(s => {
                        const sLabels = nodeStackLabels[s] ?? [];
                        return sLabels.some(l => labelFilters.has(labelPaletteKey(l.name, l.color)));
                    });
                });
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
    }, [nodes, searchQuery, isPaid, prefs, labelFilters, fleetStackLabelMap]);

    const localNode = useMemo(() => processedNodes.find(n => n.type === 'local') ?? null, [processedNodes]);
    const remoteNodes = useMemo(() => processedNodes.filter(n => n.type !== 'local'), [processedNodes]);
    const topologyNodes = useMemo(() => processedNodes.map(n => ({
        id: n.id,
        name: n.name,
        type: n.type,
        status: n.status,
        cpuPercent: getNodeCpu(n),
        memPercent: getNodeMem(n),
        diskPercent: getNodeDisk(n),
        stackCount: n.stacks?.length ?? 0,
        runningCount: n.stats?.active ?? 0,
        critical: n.status === 'online' && isCritical(n),
    })), [processedNodes]);

    const showPaidControls = isPaid && viewMode === 'grid';
    const activeFilterCount =
        (prefs.filterStatus !== 'all' ? 1 : 0) +
        (prefs.filterType !== 'all' ? 1 : 0) +
        (prefs.filterCritical ? 1 : 0) +
        (labelFilters.size > 0 ? 1 : 0);
    const clearFilters = useCallback(() => {
        updatePrefs({ filterStatus: 'all', filterType: 'all', filterCritical: false });
        setLabelFilters(new Set());
    }, [updatePrefs]);
    const allNodes = localNode ? [localNode, ...remoteNodes] : remoteNodes;

    return (
        <div className="h-full overflow-auto p-6">
            <FleetMasthead
                nodeCount={nodes.length}
                onlineCount={onlineCount}
                criticalCount={criticalCount}
                totalCpuPercent={avgCpuNum}
                worstCpu={worstCpu}
                totalMemUsed={totalMemUsed}
                totalMemTotal={totalMemTotal}
                activeContainers={totalContainers}
                totalContainers={totalContainersAll}
                lastSyncAt={lastSyncAt}
                loading={loading}
            />

            <Tabs defaultValue="overview">
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <TabsList>
                        <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                            <TabsHighlightItem value="overview">
                                <TabsTrigger value="overview">Overview</TabsTrigger>
                            </TabsHighlightItem>
                            {isPaid && (
                                <TabsHighlightItem value="snapshots">
                                    <TabsTrigger value="snapshots">
                                        <Camera className="w-4 h-4 mr-1.5" />Snapshots
                                    </TabsTrigger>
                                </TabsHighlightItem>
                            )}
                            <TabsHighlightItem value="configuration">
                                <TabsTrigger value="configuration">
                                    <SlidersHorizontal className="w-4 h-4 mr-1.5" />Status
                                </TabsTrigger>
                            </TabsHighlightItem>
                        </TabsHighlight>
                    </TabsList>
                    <div className="flex items-center gap-2">
                        {isPaid && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                    setShowUpdateModal(true);
                                    setCheckingUpdates(true);
                                    await fetchUpdateStatus();
                                    setCheckingUpdates(false);
                                }}
                                className="gap-2"
                            >
                                <Search className="w-4 h-4" />
                                Check Updates
                            </Button>
                        )}
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
                </div>

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
                            {/* Overview Toolbar: Search, Sort, Filters, View Mode */}
                            <div className="flex flex-wrap items-center gap-2 mb-4">
                                {showPaidControls && (
                                    <>
                                        <div className="relative flex-1 min-w-[200px] max-w-sm">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                                            <Input
                                                placeholder="Search nodes or stacks..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="pl-9 h-9"
                                            />
                                        </div>
                                        <div className="w-40">
                                            <Combobox
                                                options={[
                                                    { value: 'name', label: 'Name' },
                                                    { value: 'cpu', label: 'CPU Usage' },
                                                    { value: 'memory', label: 'Memory Usage' },
                                                    { value: 'containers', label: 'Containers' },
                                                    { value: 'status', label: 'Status' },
                                                ]}
                                                value={prefs.sortBy}
                                                onValueChange={(v) => updatePrefs({ sortBy: v as SortField })}
                                                placeholder="Sort by..."
                                            />
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-9 w-9 p-0 shrink-0"
                                            onClick={() => updatePrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
                                            title={prefs.sortDir === 'asc' ? 'Ascending' : 'Descending'}
                                        >
                                            <ArrowUpDown className={`w-4 h-4 ${prefs.sortDir === 'desc' ? 'rotate-180' : ''} transition-transform`} />
                                        </Button>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={activeFilterCount > 0 ? 'default' : 'outline'}
                                                    size="sm"
                                                    className="h-9 gap-2 shrink-0"
                                                >
                                                    <SlidersHorizontal className="w-4 h-4" />
                                                    Filters
                                                    {activeFilterCount > 0 && (
                                                        <Badge variant="secondary" className="h-5 min-w-[1.25rem] px-1.5 text-[10px] tabular-nums">
                                                            {activeFilterCount}
                                                        </Badge>
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent align="end" className="w-80 space-y-4">
                                                <div className="space-y-1.5">
                                                    <label className={FILTER_SECTION_LABEL_CLASS}>Status</label>
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
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className={FILTER_SECTION_LABEL_CLASS}>Type</label>
                                                    <div className="flex items-center gap-1.5">
                                                        {(['all', 'local', 'remote'] as FilterType[]).map(type => (
                                                            <Button
                                                                key={type}
                                                                variant={prefs.filterType === type ? 'default' : 'outline'}
                                                                size="sm"
                                                                className="h-7 text-xs px-2.5"
                                                                onClick={() => updatePrefs({ filterType: type })}
                                                            >
                                                                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
                                                            </Button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className={FILTER_SECTION_LABEL_CLASS}>Severity</label>
                                                    <Button
                                                        variant={prefs.filterCritical ? 'default' : 'outline'}
                                                        size="sm"
                                                        className="h-7 text-xs px-2.5"
                                                        onClick={() => updatePrefs({ filterCritical: !prefs.filterCritical })}
                                                    >
                                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                                        Critical Only
                                                    </Button>
                                                </div>
                                                {fleetPalette.length > 0 && (
                                                    <div className="space-y-1.5">
                                                        <label className={FILTER_SECTION_LABEL_CLASS}>Tags</label>
                                                        <MultiSelectCombobox
                                                            options={fleetPalette.map(p => ({ value: p.key, label: p.name, color: p.color }))}
                                                            selected={labelFilters}
                                                            onSelectionChange={setLabelFilters}
                                                            placeholder="Tags"
                                                            renderOption={(option) => (
                                                                <span className="flex items-center gap-1.5">
                                                                    <LabelDot color={option.color as LabelColor ?? 'slate'} />
                                                                    {option.label}
                                                                </span>
                                                            )}
                                                        />
                                                    </div>
                                                )}
                                                {activeFilterCount > 0 && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="w-full h-8 text-xs"
                                                        onClick={clearFilters}
                                                    >
                                                        Clear all filters
                                                    </Button>
                                                )}
                                            </PopoverContent>
                                        </Popover>
                                    </>
                                )}

                                <div className="ml-auto flex items-center gap-1 rounded-md border border-card-border bg-card p-0.5 shadow-card-bevel shrink-0">
                                    <Button
                                        variant={viewMode === 'grid' ? 'default' : 'ghost'}
                                        size="sm"
                                        className="h-8 text-xs px-2.5 gap-1.5"
                                        onClick={() => setViewMode('grid')}
                                        aria-pressed={viewMode === 'grid'}
                                    >
                                        <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.5} />
                                        Grid
                                    </Button>
                                    <Button
                                        variant={viewMode === 'topology' ? 'default' : 'ghost'}
                                        size="sm"
                                        className="h-8 text-xs px-2.5 gap-1.5"
                                        onClick={() => setViewMode('topology')}
                                        aria-pressed={viewMode === 'topology'}
                                    >
                                        <Network className="w-3.5 h-3.5" strokeWidth={1.5} />
                                        Topology
                                    </Button>
                                </div>
                            </div>

                            {viewMode === 'topology' && processedNodes.length > 0 ? (
                                <FleetTopology
                                    nodes={topologyNodes}
                                    onNodeClick={(id) => onNavigateToNode(id, '')}
                                />
                            ) : processedNodes.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
                                    {allNodes.map(node => (
                                        <NodeCard
                                            key={node.id}
                                            node={node}
                                            onNavigate={onNavigateToNode}
                                            labelMap={fleetStackLabelMap[node.id] ?? {}}
                                            updateStatus={updateStatusMap.get(node.id)}
                                            onUpdate={isPaid ? triggerNodeUpdate : undefined}
                                            updatingNodeId={updatingNodeId}
                                            onRetryUpdate={isPaid ? retryNodeUpdate : undefined}
                                            onDismissUpdate={isPaid ? dismissNodeUpdate : undefined}
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
                                            clearFilters();
                                        }}
                                    >
                                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                                        Clear filters
                                    </Button>
                                </div>
                            )}

                            {/* Paid tier auto-refresh indicator */}
                            {isPaid && (
                                <p className="text-xs text-muted-foreground text-center mt-6">
                                    Auto-refreshing every 30 seconds
                                </p>
                            )}

                            {/* Free tier: paid gate for advanced features */}
                            {!isPaid && nodes.length > 0 && (
                                <div className="mt-6">
                                    <PaidGate featureName="Fleet Management">
                                        {/* Preview of what paid tier unlocks */}
                                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                                            <div className="rounded-xl border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-4 h-24" />
                                            <div className="rounded-xl border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-4 h-24" />
                                            <div className="rounded-xl border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-4 h-24" />
                                            <div className="rounded-xl border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-4 h-24" />
                                        </div>
                                        <div className="flex gap-3 mb-4">
                                            <div className="h-9 rounded-md border border-card-border bg-card flex-1 max-w-sm" />
                                            <div className="h-9 rounded-md border border-card-border bg-card w-[150px]" />
                                        </div>
                                    </PaidGate>
                                </div>
                            )}
                        </>
                    )}
                </TabsContent>

                {isPaid && (
                    <TabsContent value="snapshots">
                        <FleetSnapshots />
                    </TabsContent>
                )}
                <TabsContent value="configuration">
                    <FleetConfiguration />
                </TabsContent>
            </Tabs>

            {/* Reconnecting overlay shown when local node is updating */}
            {reconnecting && <ReconnectingOverlay preUpdateStartedAt={preUpdateStartedAt} />}

            {/* Node Updates modal */}
            <Dialog open={showUpdateModal} onOpenChange={(open) => { setShowUpdateModal(open); if (!open) setModalSearch(''); }}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Node Updates</DialogTitle>
                        <DialogDescription className="sr-only">Check and apply updates across your fleet nodes.</DialogDescription>
                    </DialogHeader>

                    {checkingUpdates ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Checking for updates...
                        </div>
                    ) : updateStatuses.length === 0 ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                            No nodes found.
                        </div>
                    ) : (() => {
                        const upToDate = updateStatuses.filter(s => !s.updateAvailable && !s.updateStatus).length;
                        const available = updateStatuses.filter(s => s.updateAvailable && !s.updateStatus).length;
                        const updating = updateStatuses.filter(s => s.updateStatus === 'updating').length;
                        const failed = updateStatuses.filter(s => s.updateStatus === 'failed' || s.updateStatus === 'timeout').length;
                        const q = modalSearch.toLowerCase();
                        const filtered = q ? updateStatuses.filter(s => s.name.toLowerCase().includes(q) || s.type.includes(q)) : updateStatuses;
                        const gatewayLabel = formatVersion(updateStatuses[0]?.latestVersion);

                        return (
                            <>
                                {/* Summary stats */}
                                <div className="grid grid-cols-4 gap-2">
                                    <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel px-3 py-2 text-center">
                                        <div className="text-lg font-medium tabular-nums tracking-tight text-stat-value">{upToDate}</div>
                                        <div className="text-[10px] text-stat-subtitle flex items-center justify-center gap-1">
                                            <CircleCheck className="w-3 h-3 text-success" strokeWidth={1.5} /> Up to date
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel px-3 py-2 text-center">
                                        <div className="text-lg font-medium tabular-nums tracking-tight text-stat-value">{available}</div>
                                        <div className="text-[10px] text-stat-subtitle flex items-center justify-center gap-1">
                                            <CircleAlert className="w-3 h-3 text-warning" strokeWidth={1.5} /> Available
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel px-3 py-2 text-center">
                                        <div className="text-lg font-medium tabular-nums tracking-tight text-stat-value">{updating}</div>
                                        <div className="text-[10px] text-stat-subtitle flex items-center justify-center gap-1">
                                            <Loader2 className="w-3 h-3 text-info" strokeWidth={1.5} /> Updating
                                        </div>
                                    </div>
                                    <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel px-3 py-2 text-center">
                                        <div className="text-lg font-medium tabular-nums tracking-tight text-stat-value">{failed}</div>
                                        <div className="text-[10px] text-stat-subtitle flex items-center justify-center gap-1">
                                            <AlertTriangle className="w-3 h-3 text-destructive/70" strokeWidth={1.5} /> Failed
                                        </div>
                                    </div>
                                </div>

                                {/* Search + gateway version */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                        <Input
                                            placeholder="Filter nodes..."
                                            value={modalSearch}
                                            onChange={e => setModalSearch(e.target.value)}
                                            className="h-8 pl-8 text-xs"
                                        />
                                    </div>
                                    {gatewayLabel && (
                                        <div className="text-[11px] text-muted-foreground shrink-0">
                                            Latest: <span className="font-mono tabular-nums text-foreground">{gatewayLabel}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Table header */}
                                <div className="grid grid-cols-[1fr_80px_100px_100px_120px] gap-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wider">
                                    <span>Node</span>
                                    <span>Type</span>
                                    <span>Current</span>
                                    <span>Latest</span>
                                    <span className="text-right">Status</span>
                                </div>

                                {/* Node list */}
                                <ScrollArea className="flex-1 min-h-0 max-h-[40vh] -mx-1 px-1">
                                  <div className="space-y-1">
                                    {filtered.map(s => (
                                        <div key={s.nodeId} className="grid grid-cols-[1fr_80px_100px_100px_120px] gap-2 items-center rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel px-3 py-2">
                                            {/* Node name */}
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className={`flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${s.updateAvailable && !s.updateStatus ? 'bg-warning/10' : 'bg-muted'}`}>
                                                    {s.type === 'local'
                                                        ? <Monitor className={`w-3 h-3 ${s.updateAvailable && !s.updateStatus ? 'text-warning' : 'text-muted-foreground'}`} strokeWidth={1.5} />
                                                        : <Globe className={`w-3 h-3 ${s.updateAvailable && !s.updateStatus ? 'text-warning' : 'text-muted-foreground'}`} strokeWidth={1.5} />
                                                    }
                                                </div>
                                                <span className="text-sm font-medium truncate">{s.name}</span>
                                            </div>

                                            {/* Type */}
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 w-fit">
                                                {s.type}
                                            </Badge>

                                            {/* Current version */}
                                            <span className="text-xs font-mono tabular-nums text-muted-foreground">
                                                {formatVersion(s.version) ?? <span className="text-muted-foreground/50 italic text-[10px]">unknown</span>}
                                            </span>

                                            {/* Latest version */}
                                            <span className="text-xs font-mono tabular-nums">
                                                {formatVersion(s.latestVersion) ?? <span className="text-muted-foreground/50 italic text-[10px]">unknown</span>}
                                            </span>

                                            {/* Status / Action */}
                                            <div className="flex justify-end">
                                                {s.updateStatus && (
                                                    <UpdateStatusBadge
                                                        status={s.updateStatus}
                                                        error={s.error}
                                                        onRetry={() => retryNodeUpdate(s.nodeId)}
                                                        onDismiss={() => dismissNodeUpdate(s.nodeId)}
                                                    />
                                                )}
                                                {!s.updateStatus && !s.updateAvailable && (
                                                    <Badge className="text-[10px] px-1.5 py-0 h-5 bg-success-muted text-success border-success/30">
                                                        <Check className="w-2.5 h-2.5 mr-0.5" /> Up to date
                                                    </Badge>
                                                )}
                                                {s.updateAvailable && !s.updateStatus && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-6 text-[11px] px-2.5"
                                                        onClick={() => triggerNodeUpdate(s.nodeId)}
                                                        disabled={updatingNodeId === s.nodeId}
                                                    >
                                                        {updatingNodeId === s.nodeId ? (
                                                            <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Updating</>
                                                        ) : (
                                                            <><Download className="w-3 h-3 mr-1" strokeWidth={1.5} />Update</>
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {filtered.length === 0 && (
                                        <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                                            No nodes match &ldquo;{modalSearch}&rdquo;
                                        </div>
                                    )}
                                  </div>
                                </ScrollArea>

                                {/* Footer */}
                                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs text-muted-foreground"
                                        disabled={recheckingUpdates}
                                        onClick={async () => {
                                            setRecheckingUpdates(true);
                                            try {
                                                await apiFetch('/fleet/update-status?recheck=true', { method: 'DELETE', localOnly: true });
                                                await fetchUpdateStatus();
                                            } catch (err) {
                                                console.warn('[Fleet] Recheck failed:', err);
                                            } finally {
                                                setRecheckingUpdates(false);
                                            }
                                        }}
                                    >
                                        <RefreshCw className={`w-3 h-3 mr-1.5 ${recheckingUpdates ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                                        Recheck
                                    </Button>
                                    {updatableRemoteCount > 0 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={triggerUpdateAll}
                                            className="h-7 gap-1.5"
                                        >
                                            <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                                            Update All ({updatableRemoteCount})
                                        </Button>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* Confirm dialog for local node update */}
            <AlertDialog open={localUpdateConfirm !== null} onOpenChange={(open) => { if (!open) setLocalUpdateConfirm(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Update local node?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will pull the latest Sencho image and restart the server. The dashboard will be
                            briefly disconnected and will automatically reconnect when the update completes.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmLocalUpdate}>
                            <Download className="w-4 h-4 mr-1.5" strokeWidth={1.5} />
                            Update & Restart
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
