import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from "@/components/ui/tabs";
import { springs } from '@/lib/motion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { Trash2, HardDrive, Network, PackageMinus, MonitorX, MoreVertical, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useNodes } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface UsageData {
    reclaimableImages: number;
    reclaimableContainers: number;
    reclaimableVolumes: number;
    managedImageBytes: number;
    unmanagedImageBytes: number;
    managedVolumeBytes: number;
    unmanagedVolumeBytes: number;
}

interface DockerImage {
    Id: string;
    RepoTags: string[];
    Size: number;
    Containers: number;
    managedBy: string | null;
    managedStatus: 'managed' | 'unmanaged' | 'unused';
}

interface DockerVolume {
    Name: string;
    Driver: string;
    Mountpoint: string;
    managedBy: string | null;
    managedStatus: 'managed' | 'unmanaged';
}

interface DockerNetwork {
    Id: string;
    Name: string;
    Driver: string;
    Scope: string;
    managedBy: string | null;
    managedStatus: 'managed' | 'unmanaged' | 'system';
}

interface UnmanagedContainer {
    Id: string;
    Names: string[];
    State: string;
    Status: string;
    Image: string;
}

type ResourceFilter = 'all' | 'managed' | 'unmanaged';
type PruneTarget = 'containers' | 'images' | 'networks' | 'volumes';
type PruneScope = 'managed' | 'all';

// ── Disk Footprint Widget ──────────────────────────────────────────────────────

interface FootprintWidgetProps {
    usage: UsageData;
    onFilter: (filter: ResourceFilter) => void;
}

function FootprintWidget({ usage, onFilter }: FootprintWidgetProps) {
    const [animated, setAnimated] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const managedBytes = usage.managedImageBytes + usage.managedVolumeBytes;
    const unmanagedBytes = usage.unmanagedImageBytes + usage.unmanagedVolumeBytes;
    const reclaimable = usage.reclaimableImages;
    const total = managedBytes + unmanagedBytes + reclaimable;

    useEffect(() => {
        // Trigger bar animation on mount
        const t = setTimeout(() => setAnimated(true), 60);
        return () => clearTimeout(t);
    }, []);

    if (total === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-28 text-muted-foreground text-sm gap-2 animate-in fade-in-0 duration-300">
                <ShieldCheck className="w-8 h-8 opacity-40" />
                <span>No disk usage data available.</span>
            </div>
        );
    }

    const pct = (n: number) => `${Math.max(0, (n / total) * 100).toFixed(1)}%`;

    const segments: { bytes: number; color: string; label: string; filter: ResourceFilter | null; hoverClass: string }[] = [
        { bytes: managedBytes, color: 'bg-success', label: 'Sencho Managed', filter: 'managed', hoverClass: 'hover:bg-success/80' },
        { bytes: unmanagedBytes, color: 'bg-warning', label: 'External Projects', filter: 'unmanaged', hoverClass: 'hover:bg-warning/80' },
        { bytes: reclaimable, color: 'bg-muted-foreground/20', label: 'Reclaimable', filter: null, hoverClass: '' },
    ];

    return (
        <div ref={ref} className="space-y-4 animate-in fade-in-0 duration-300">
            {/* Stacked bar */}
            <div className="relative flex h-4 w-full rounded-full overflow-hidden bg-muted gap-px">
                {segments.map((seg, i) =>
                    seg.bytes > 0 ? (
                        <div
                            key={i}
                            title={`${seg.label}: ${formatBytes(seg.bytes)}`}
                            className={cn(
                                seg.color, seg.hoverClass,
                                'transition-all duration-700 ease-out',
                                seg.filter ? 'cursor-pointer' : 'cursor-default',
                            )}
                            style={{
                                width: animated ? pct(seg.bytes) : '0%',
                                transitionDelay: `${i * 80}ms`,
                            }}
                            onClick={() => seg.filter && onFilter(seg.filter)}
                        />
                    ) : null
                )}
            </div>

            {/* Legend */}
            <div className="space-y-2.5">
                {segments.map((seg, i) =>
                    seg.bytes > 0 ? (
                        <button
                            key={i}
                            disabled={!seg.filter}
                            onClick={() => seg.filter && onFilter(seg.filter)}
                            className={cn(
                                'flex items-center justify-between w-full text-sm group rounded-md px-1 py-0.5 -mx-1 transition-colors duration-150',
                                seg.filter ? 'cursor-pointer hover:bg-muted/60' : 'cursor-default',
                            )}
                        >
                            <div className="flex items-center gap-2.5 text-muted-foreground group-hover:text-foreground transition-colors">
                                <span className={cn('w-2.5 h-2.5 rounded-sm shrink-0', seg.color)} />
                                <span className="font-medium text-xs tracking-wide">{seg.label}</span>
                            </div>
                            <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                {formatBytes(seg.bytes)}
                            </span>
                        </button>
                    ) : null
                )}
            </div>
        </div>
    );
}

// ── Filter Toggle - Segmented Control ─────────────────────────────────────────

interface FilterToggleProps {
    value: ResourceFilter;
    onChange: (v: ResourceFilter) => void;
    counts: { all: number; managed: number; unmanaged: number };
}

function FilterToggle({ value, onChange, counts }: FilterToggleProps) {
    const options: { key: ResourceFilter; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: counts.all },
        { key: 'managed', label: 'Managed', count: counts.managed },
        { key: 'unmanaged', label: 'External', count: counts.unmanaged },
    ];

    return (
        <div className="flex items-center gap-1 px-3 py-2.5 border-b bg-muted/10">
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
                {options.map(({ key, label, count }) => (
                    <button
                        key={key}
                        onClick={() => onChange(key)}
                        className={cn(
                            'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200',
                            value === key
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {label}
                        <span className={cn(
                            'inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm text-[10px] font-mono transition-colors duration-200',
                            value === key ? 'bg-muted text-foreground' : 'text-muted-foreground/70',
                        )}>
                            {count}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Managed Status Badge ───────────────────────────────────────────────────────

function ManagedBadge({ status, managedBy }: {
    status: 'managed' | 'unmanaged' | 'unused' | 'system';
    managedBy: string | null;
}) {
    if (status === 'managed') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-success/25 bg-success/8 text-success text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                {managedBy}
            </span>
        );
    }
    if (status === 'unmanaged') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-warning/25 bg-warning/8 text-warning text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                External
            </span>
        );
    }
    if (status === 'system') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 text-muted-foreground text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                System
            </span>
        );
    }
    return null;
}

// ── Quick Clean Prune Button ───────────────────────────────────────────────────

interface PruneButtonProps {
    target: PruneTarget;
    icon: React.ReactNode;
    label: string;
    accentClass: string;
    onManaged: () => void;
    onAll: () => void;
}

function PruneButton({ target, icon, label, accentClass, onManaged, onAll }: PruneButtonProps) {
    return (
        <div className={cn(
            'group flex flex-col rounded-lg border bg-card overflow-hidden',
            'transition-shadow duration-200 hover:shadow-md',
        )}>
            <button
                onClick={onManaged}
                className="flex-1 flex flex-col items-center justify-center gap-2 p-3 pt-4 hover:bg-muted/40 transition-colors duration-150"
            >
                <span className={cn('transition-transform duration-200 group-hover:scale-110', accentClass)}>
                    {icon}
                </span>
                <span className="text-xs font-medium text-center leading-tight text-foreground">{label}</span>
                <span className="text-[10px] text-brand font-mono tracking-wide">Sencho only</span>
            </button>
            {target !== 'containers' && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className={cn(
                            'flex items-center justify-center gap-1 border-t h-7 w-full text-[10px] text-muted-foreground',
                            'hover:bg-muted/40 hover:text-foreground transition-colors duration-150',
                        )}>
                            <MoreVertical className="w-3 h-3" />
                            <span>More options</span>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive focus:bg-destructive/10 gap-2 text-xs"
                            onClick={onAll}
                        >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>All Docker <span className="text-muted-foreground">(includes external)</span></span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

// ── Table Skeleton ─────────────────────────────────────────────────────────────

function TableSkeleton({ cols, rows = 5 }: { cols: number; rows?: number }) {
    return (
        <TableBody>
            {Array.from({ length: rows }).map((_, r) => (
                <TableRow key={r} className="animate-in fade-in-0" style={{ animationDelay: `${r * 40}ms` }}>
                    {Array.from({ length: cols }).map((_, c) => (
                        <TableCell key={c}>
                            <Skeleton className={cn('h-4', c === 0 ? 'w-24' : c === 1 ? 'w-48' : 'w-16')} />
                        </TableCell>
                    ))}
                </TableRow>
            ))}
        </TableBody>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ResourcesView() {
    const { isAdmin } = useAuth();
    const { activeNode } = useNodes();
    const [usage, setUsage] = useState<UsageData | null>(null);
    const [images, setImages] = useState<DockerImage[]>([]);
    const [volumes, setVolumes] = useState<DockerVolume[]>([]);
    const [networks, setNetworks] = useState<DockerNetwork[]>([]);
    const [orphans, setOrphans] = useState<Record<string, UnmanagedContainer[]>>({});

    const [isLoading, setIsLoading] = useState(true);
    const [isActioning, setIsActioning] = useState(false);

    // Filter state
    const [imageFilter, setImageFilter] = useState<ResourceFilter>('all');
    const [volumeFilter, setVolumeFilter] = useState<ResourceFilter>('all');
    const [networkFilter, setNetworkFilter] = useState<ResourceFilter>('all');

    // Modal states
    const [confirmPrune, setConfirmPrune] = useState<{ target: PruneTarget; scope: PruneScope } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ type: 'images' | 'volumes' | 'networks'; id: string; name?: string } | null>(null);

    // Unmanaged container state
    const [selectedOrphans, setSelectedOrphans] = useState<string[]>([]);
    const [bulkPurgeConfirm, setBulkPurgeConfirm] = useState(false);

    const fetchAllData = async () => {
        setIsLoading(true);
        try {
            const [usageRes, resourcesRes, orphansRes] = await Promise.all([
                apiFetch('/system/docker-df'),
                apiFetch('/system/resources'),
                apiFetch('/system/orphans'),
            ]);

            setUsage(await usageRes.json());
            const resources = await resourcesRes.json();
            setImages(resources.images ?? []);
            setVolumes(resources.volumes ?? []);
            setNetworks(resources.networks ?? []);
            setOrphans(await orphansRes.json());
            setSelectedOrphans([]);
        } catch (err) {
            console.error('Failed to fetch data', err);
            toast.error('Failed to load resources data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchAllData(); }, [activeNode]);

    const handlePrune = async () => {
        if (!confirmPrune) return;
        setIsActioning(true);
        try {
            const res = await apiFetch('/system/prune/system', {
                method: 'POST',
                body: JSON.stringify({ target: confirmPrune.target, scope: confirmPrune.scope })
            });
            const data = await res.json();
            const scopeLabel = confirmPrune.scope === 'managed' ? 'Sencho-managed' : 'all';
            toast.success(
                data.reclaimedBytes !== undefined
                    ? `Pruned ${scopeLabel} ${confirmPrune.target}. Reclaimed ${formatBytes(data.reclaimedBytes)}.`
                    : `Pruned ${scopeLabel} ${confirmPrune.target}.`
            );
            await fetchAllData();
        } catch {
            toast.error(confirmPrune ? `Failed to prune ${confirmPrune.target}` : 'Prune failed');
        } finally {
            setIsActioning(false);
            setConfirmPrune(null);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setIsActioning(true);
        try {
            const res = await apiFetch(`/system/${confirmDelete.type}/delete`, {
                method: 'POST',
                body: JSON.stringify({ id: confirmDelete.id })
            });
            if (!res.ok) throw new Error();
            toast.success(`Deleted ${confirmDelete.type.slice(0, -1)}`);
            await fetchAllData();
        } catch {
            toast.error(`Failed to delete ${confirmDelete.type.slice(0, -1)}`);
        } finally {
            setIsActioning(false);
            setConfirmDelete(null);
        }
    };

    const toggleOrphan = (id: string) =>
        setSelectedOrphans(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    const totalOrphansCount = Object.values(orphans).flat().length;
    const selectAllOrphans = () => {
        const allIds = Object.values(orphans).flat().map(c => c.Id);
        setSelectedOrphans(selectedOrphans.length === allIds.length ? [] : allIds);
    };

    const handlePurgeOrphans = async () => {
        setIsActioning(true);
        try {
            const res = await apiFetch('/system/prune/orphans', {
                method: 'POST',
                body: JSON.stringify({ containerIds: selectedOrphans })
            });
            if (!res.ok) throw new Error();
            toast.success(`Purged ${selectedOrphans.length} unmanaged container(s)`);
            setBulkPurgeConfirm(false);
            await fetchAllData();
        } catch {
            toast.error('Failed to purge selected containers.');
        } finally {
            setIsActioning(false);
        }
    };

    // Derived filtered lists
    const filteredImages = images.filter(img =>
        imageFilter === 'managed' ? img.managedStatus === 'managed' :
            imageFilter === 'unmanaged' ? img.managedStatus !== 'managed' : true
    );
    const filteredVolumes = volumes.filter(vol =>
        volumeFilter === 'managed' ? vol.managedStatus === 'managed' :
            volumeFilter === 'unmanaged' ? vol.managedStatus !== 'managed' : true
    );
    const filteredNetworks = networks.filter(net =>
        networkFilter === 'managed' ? net.managedStatus === 'managed' :
            networkFilter === 'unmanaged' ? net.managedStatus !== 'managed' : true
    );

    const handleFootprintFilter = (filter: ResourceFilter) => {
        setImageFilter(filter);
        setVolumeFilter(filter);
    };

    return (
        <div className="p-6 h-full overflow-auto text-foreground flex flex-col gap-6 animate-in fade-in-0 duration-300">

            {/* Header */}
            <div className="flex items-center gap-3">
                <HardDrive className="w-5 h-5 text-muted-foreground" />
                <h1 className="text-xl font-medium tracking-tight">Resources Hub</h1>
                {activeNode?.type === 'remote' && (
                    <span className="text-sm text-muted-foreground">- {activeNode.name}</span>
                )}
            </div>

            {/* Top row: Footprint + Quick Clean */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Disk Footprint */}
                <Card className="col-span-1 border-border shadow-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground tracking-wide uppercase">
                            Docker Disk Footprint
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Click a segment to filter the tabs below
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {usage ? (
                            <FootprintWidget usage={usage} onFilter={handleFootprintFilter} />
                        ) : (
                            <div className="space-y-3">
                                <Skeleton className="h-4 w-full rounded-full" />
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-4 w-3/4" />
                                    <Skeleton className="h-4 w-1/2" />
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Quick Clean */}
                {isAdmin && <Card className="col-span-1 md:col-span-2 border-border shadow-sm flex flex-col animate-in fade-in-0 slide-in-from-bottom-2 duration-300 delay-75">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium text-muted-foreground tracking-wide uppercase">
                            Quick Clean
                        </CardTitle>
                        <CardDescription className="text-xs">
                            Primary actions target <span className="text-foreground font-medium">Sencho-managed</span> resources only.
                            Use <MoreVertical className="inline w-3 h-3" /> for all-Docker operations.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col justify-center">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <PruneButton
                                target="images"
                                icon={<PackageMinus className="w-6 h-6" />}
                                label="Prune Unused Images"
                                accentClass="text-blue-500"
                                onManaged={() => setConfirmPrune({ target: 'images', scope: 'managed' })}
                                onAll={() => setConfirmPrune({ target: 'images', scope: 'all' })}
                            />
                            <PruneButton
                                target="volumes"
                                icon={<HardDrive className="w-6 h-6" />}
                                label="Prune Unused Volumes"
                                accentClass="text-purple-500"
                                onManaged={() => setConfirmPrune({ target: 'volumes', scope: 'managed' })}
                                onAll={() => setConfirmPrune({ target: 'volumes', scope: 'all' })}
                            />
                            <PruneButton
                                target="networks"
                                icon={<Network className="w-6 h-6" />}
                                label="Prune Dead Networks"
                                accentClass="text-success"
                                onManaged={() => setConfirmPrune({ target: 'networks', scope: 'managed' })}
                                onAll={() => setConfirmPrune({ target: 'networks', scope: 'all' })}
                            />
                            <PruneButton
                                target="containers"
                                icon={<MonitorX className="w-6 h-6" />}
                                label="Purge Unmanaged Containers"
                                accentClass="text-warning"
                                onManaged={() => setConfirmPrune({ target: 'containers', scope: 'managed' })}
                                onAll={() => setConfirmPrune({ target: 'containers', scope: 'all' })}
                            />
                        </div>
                    </CardContent>
                </Card>}
            </div>

            {/* Resource Tabs */}
            <Tabs
                defaultValue="images"
                className="flex-1 flex flex-col w-full rounded-lg border bg-card shadow-sm overflow-hidden min-h-[400px] animate-in fade-in-0 slide-in-from-bottom-2 duration-300 delay-150"
            >
                <div className="px-4 pt-3 pb-0 border-b border-glass-border bg-glass">
                    <TabsList className="grid grid-cols-4 w-full md:w-[680px] h-9 gap-1 p-0">
                        <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                            {(['images', 'volumes', 'networks'] as const).map(tab => (
                                <TabsHighlightItem key={tab} value={tab}>
                                    <TabsTrigger value={tab} className="capitalize text-xs">
                                        {tab}
                                    </TabsTrigger>
                                </TabsHighlightItem>
                            ))}
                            <TabsHighlightItem value="unmanaged">
                                <TabsTrigger value="unmanaged" className="relative text-xs">
                                    Unmanaged
                                    {totalOrphansCount > 0 && (
                                        <span className="absolute -top-1.5 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-warning text-[9px] text-warning-foreground font-medium animate-in zoom-in-75 duration-200">
                                            {totalOrphansCount}
                                        </span>
                                    )}
                                </TabsTrigger>
                            </TabsHighlightItem>
                        </TabsHighlight>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-auto bg-background relative text-sm">

                    {/* Images */}
                    <TabsContent value="images" className="m-0 border-0 p-0 animate-in fade-in-0 duration-200">
                        <FilterToggle
                            value={imageFilter}
                            onChange={setImageFilter}
                            counts={{
                                all: images.length,
                                managed: images.filter(i => i.managedStatus === 'managed').length,
                                unmanaged: images.filter(i => i.managedStatus !== 'managed').length,
                            }}
                        />
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="w-[120px] text-[11px]">ID</TableHead>
                                    <TableHead className="text-[11px]">Repository:Tag</TableHead>
                                    <TableHead className="text-[11px]">Size</TableHead>
                                    <TableHead className="text-[11px]">Status</TableHead>
                                    <TableHead className="text-right text-[11px]">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            {isLoading ? <TableSkeleton cols={5} /> : (
                                <TableBody>
                                    {filteredImages.length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No images found.</TableCell></TableRow>
                                    ) : filteredImages.map((img, i) => (
                                        <TableRow
                                            key={img.Id}
                                            className="animate-in fade-in-0 duration-200 hover:bg-muted/30 transition-colors"
                                            style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                                        >
                                            <TableCell className="font-mono text-xs text-muted-foreground">{img.Id.split(':')[1]?.substring(0, 12)}</TableCell>
                                            <TableCell className="font-medium">{img.RepoTags?.[0] || '<none>:<none>'}</TableCell>
                                            <TableCell className="font-mono text-xs tabular-nums">{formatBytes(img.Size)}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <Badge variant={img.Containers > 0 ? "default" : "secondary"} className="text-[10px] h-5">
                                                        {img.Containers > 0 ? "In Use" : "Unused"}
                                                    </Badge>
                                                    <ManagedBadge status={img.managedStatus} managedBy={img.managedBy} />
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-red-500 hover:bg-red-500/10 transition-colors" onClick={() => setConfirmDelete({ type: 'images', id: img.Id, name: img.RepoTags?.[0] })}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            )}
                        </Table>
                    </TabsContent>

                    {/* Volumes */}
                    <TabsContent value="volumes" className="m-0 border-0 p-0 animate-in fade-in-0 duration-200">
                        <FilterToggle
                            value={volumeFilter}
                            onChange={setVolumeFilter}
                            counts={{
                                all: volumes.length,
                                managed: volumes.filter(v => v.managedStatus === 'managed').length,
                                unmanaged: volumes.filter(v => v.managedStatus !== 'managed').length,
                            }}
                        />
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="text-[11px]">Name</TableHead>
                                    <TableHead className="text-[11px]">Driver</TableHead>
                                    <TableHead className="hidden md:table-cell text-[11px]">Mountpoint</TableHead>
                                    <TableHead className="text-[11px]">Status</TableHead>
                                    <TableHead className="text-right text-[11px]">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            {isLoading ? <TableSkeleton cols={5} /> : (
                                <TableBody>
                                    {filteredVolumes.length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No volumes found.</TableCell></TableRow>
                                    ) : filteredVolumes.map((vol, i) => (
                                        <TableRow
                                            key={vol.Name}
                                            className="animate-in fade-in-0 duration-200 hover:bg-muted/30 transition-colors"
                                            style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                                        >
                                            <TableCell className="font-mono text-xs max-w-[200px] truncate">{vol.Name}</TableCell>
                                            <TableCell><Badge variant="outline" className="text-[10px] h-5">{vol.Driver}</Badge></TableCell>
                                            <TableCell className="hidden md:table-cell text-xs text-muted-foreground truncate max-w-[300px]">{vol.Mountpoint}</TableCell>
                                            <TableCell><ManagedBadge status={vol.managedStatus} managedBy={vol.managedBy} /></TableCell>
                                            <TableCell className="text-right">
                                                {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-red-500 hover:bg-red-500/10 transition-colors" onClick={() => setConfirmDelete({ type: 'volumes', id: vol.Name, name: vol.Name })}>
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            )}
                        </Table>
                    </TabsContent>

                    {/* Networks */}
                    <TabsContent value="networks" className="m-0 border-0 p-0 animate-in fade-in-0 duration-200">
                        <FilterToggle
                            value={networkFilter}
                            onChange={setNetworkFilter}
                            counts={{
                                all: networks.length,
                                managed: networks.filter(n => n.managedStatus === 'managed').length,
                                unmanaged: networks.filter(n => n.managedStatus !== 'managed').length,
                            }}
                        />
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="w-[120px] text-[11px]">ID</TableHead>
                                    <TableHead className="text-[11px]">Name</TableHead>
                                    <TableHead className="text-[11px]">Driver</TableHead>
                                    <TableHead className="text-[11px]">Scope</TableHead>
                                    <TableHead className="text-[11px]">Status</TableHead>
                                    <TableHead className="text-right text-[11px]">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            {isLoading ? <TableSkeleton cols={6} /> : (
                                <TableBody>
                                    {filteredNetworks.length === 0 ? (
                                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No networks found.</TableCell></TableRow>
                                    ) : filteredNetworks.map((net, i) => (
                                        <TableRow
                                            key={net.Id}
                                            className="animate-in fade-in-0 duration-200 hover:bg-muted/30 transition-colors"
                                            style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                                        >
                                            <TableCell className="font-mono text-xs text-muted-foreground">{net.Id.substring(0, 12)}</TableCell>
                                            <TableCell className="font-medium max-w-[200px] truncate">{net.Name}</TableCell>
                                            <TableCell className="text-xs">{net.Driver}</TableCell>
                                            <TableCell><Badge variant="outline" className="text-[10px] h-5">{net.Scope}</Badge></TableCell>
                                            <TableCell><ManagedBadge status={net.managedStatus} managedBy={net.managedBy} /></TableCell>
                                            <TableCell className="text-right">
                                                {isAdmin && <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                                                    disabled={net.managedStatus === 'system'}
                                                    onClick={() => setConfirmDelete({ type: 'networks', id: net.Id, name: net.Name })}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            )}
                        </Table>
                    </TabsContent>

                    {/* Unmanaged Containers */}
                    <TabsContent value="unmanaged" className="m-0 border-0 p-0 h-full flex flex-col animate-in fade-in-0 duration-200">
                        <div className="flex justify-between items-center px-4 py-2.5 border-b bg-muted/10 sticky top-0 z-10">
                            <div className="flex items-center gap-2.5">
                                <input
                                    type="checkbox"
                                    onChange={selectAllOrphans}
                                    checked={selectedOrphans.length === totalOrphansCount && totalOrphansCount > 0}
                                    className="rounded border-border focus:ring-ring h-4 w-4 accent-foreground"
                                />
                                <span className="text-xs font-medium text-muted-foreground">Select all</span>
                            </div>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="h-7 text-xs gap-1.5"
                                onClick={() => setBulkPurgeConfirm(true)}
                                disabled={selectedOrphans.length === 0 || isActioning}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {isActioning ? 'Purging...' : `Purge Selected (${selectedOrphans.length})`}
                            </Button>
                        </div>

                        {totalOrphansCount === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground animate-in fade-in-0 duration-300">
                                <div className="w-12 h-12 rounded-full bg-success-muted flex items-center justify-center mb-3">
                                    <ShieldCheck className="w-6 h-6 text-success" />
                                </div>
                                <p className="font-medium text-sm">No unmanaged containers</p>
                                <p className="text-xs mt-1 opacity-70">All running containers are managed by Sencho.</p>
                            </div>
                        ) : (
                            <div className="p-4 space-y-3 pb-12">
                                {Object.entries(orphans).map(([project, containers], gi) => (
                                    <div
                                        key={project}
                                        className="bg-card rounded-lg border shadow-sm overflow-hidden text-sm animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
                                        style={{ animationDelay: `${gi * 60}ms` }}
                                    >
                                        {/* Project header */}
                                        <div className="bg-warning/8 border-b border-warning/15 px-4 py-2 font-medium text-xs flex items-center gap-2">
                                            <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse shrink-0" />
                                            <span className="text-warning">External Project:</span>
                                            <span className="font-mono text-foreground">{project}</span>
                                            <span className="ml-auto text-muted-foreground font-normal">{containers.length} container{containers.length !== 1 ? 's' : ''}</span>
                                        </div>
                                        <div className="divide-y divide-border/50">
                                            {containers.map((container: UnmanagedContainer) => (
                                                <div
                                                    key={container.Id}
                                                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors duration-150"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedOrphans.includes(container.Id)}
                                                        onChange={() => toggleOrphan(container.Id)}
                                                        className="rounded border-border h-4 w-4 accent-foreground"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono text-xs font-medium truncate">
                                                                {container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12)}
                                                            </span>
                                                            <Badge
                                                                variant={container.State === 'running' ? 'default' : 'secondary'}
                                                                className="text-[9px] h-4 px-1.5"
                                                            >
                                                                {container.State}
                                                            </Badge>
                                                        </div>
                                                        <div className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono">
                                                            {container.Image}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>
                </div>
            </Tabs>

            {/* ── Dialogs ── */}

            {/* Prune Confirm */}
            <AlertDialog open={!!confirmPrune} onOpenChange={(open) => !open && setConfirmPrune(null)}>
                <AlertDialogContent className="animate-in fade-in-0 zoom-in-95 duration-200">
                    <AlertDialogHeader>
                        {confirmPrune?.scope === 'all' ? (
                            <>
                                <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    Prune All Docker {confirmPrune?.target}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will prune <span className="font-medium text-foreground">all</span> unused {confirmPrune?.target} from the Docker daemon -
                                    including those from <span className="font-medium text-foreground">external projects not managed by Sencho</span>. This cannot be undone.
                                </AlertDialogDescription>
                            </>
                        ) : (
                            <>
                                <AlertDialogTitle>Prune Sencho-Managed {confirmPrune?.target}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Only unused {confirmPrune?.target} belonging to your Sencho stacks will be removed.
                                    External Docker resources are <span className="font-medium text-foreground">not affected</span>.
                                </AlertDialogDescription>
                            </>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isActioning}
                            className={confirmPrune?.scope === 'all' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
                            onClick={handlePrune}
                        >
                            {isActioning ? 'Pruning...' : confirmPrune?.scope === 'all' ? 'Prune All' : 'Prune'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete Confirm */}
            <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {confirmDelete?.type.slice(0, -1)}</AlertDialogTitle>
                        <AlertDialogDescription>
                            Permanently delete <span className="font-mono font-medium text-foreground">{confirmDelete?.name || confirmDelete?.id.substring(0, 12)}</span>? This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isActioning} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
                            {isActioning ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Unmanaged Container Purge Confirm */}
            <AlertDialog open={bulkPurgeConfirm} onOpenChange={setBulkPurgeConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Purge Selected Unmanaged Containers</AlertDialogTitle>
                        <AlertDialogDescription>
                            Permanently remove {selectedOrphans.length} container{selectedOrphans.length !== 1 ? 's' : ''} from external projects?
                            This will force-stop and remove them. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActioning}>Cancel</AlertDialogCancel>
                        <AlertDialogAction disabled={isActioning} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handlePurgeOrphans}>
                            {isActioning ? 'Purging...' : 'Purge'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
