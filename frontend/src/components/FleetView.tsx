import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useExperimental } from '@/hooks/useExperimental';
import {
    RefreshCw, Search, Camera,
    Network, SlidersHorizontal,
    Send, KeyRound, ArrowLeftRight,
} from 'lucide-react';
import { FleetMasthead } from './fleet/FleetMasthead';
import { ReconnectingOverlay } from './FleetView/ReconnectingOverlay';
import { NodeUpdatesSheet } from './FleetView/NodeUpdatesSheet';
import { LocalUpdateConfirmDialog } from './FleetView/LocalUpdateConfirmDialog';
import { isCritical, getNodeCpu, getNodeMem, getNodeDisk } from './FleetView/nodeUtils';
import { OverviewTab } from './FleetView/OverviewTab';
import type { FleetNode, NodeUpdateStatus, ViewMode } from './FleetView/types';
import { useFleetPreferences } from './FleetView/hooks/useFleetPreferences';
import { useFleetLabels, labelPaletteKey } from './FleetView/hooks/useFleetLabels';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '@/components/ui/tabs';
import { springs } from '@/lib/motion';
import { apiFetch } from '@/lib/api';
import { useLicense } from '@/context/LicenseContext';
import { AdmiralGate } from './AdmiralGate';
import FleetSnapshots from './FleetSnapshots';
import { FleetConfiguration } from './fleet/FleetConfiguration';
import { FleetSoonPlaceholder, SoonBadge } from './fleet/FleetSoonPlaceholder';
import { RoutingTab } from './fleet/RoutingTab';
import { DeploymentsTab } from './blueprints/DeploymentsTab';
import { toast } from '@/components/ui/toast-store';

interface FleetViewProps {
    onNavigateToNode: (nodeId: number, stackName: string) => void;
}

export function FleetView({ onNavigateToNode }: FleetViewProps) {
    const [nodes, setNodes] = useState<FleetNode[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const { isPaid, license } = useLicense();
    const isAdmiral = isPaid && license?.variant === 'admiral';
    const experimental = useExperimental();
    const [updateStatuses, setUpdateStatuses] = useState<NodeUpdateStatus[]>([]);
    const [updatingNodeId, setUpdatingNodeId] = useState<number | null>(null);
    const [reconnecting, setReconnecting] = useState(false);
    const [preUpdateStartedAt, setPreUpdateStartedAt] = useState<number | null>(null);
    const [localUpdateConfirm, setLocalUpdateConfirm] = useState<number | null>(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [checkingUpdates, setCheckingUpdates] = useState(false);
    const updateStatusesRef = useRef(updateStatuses);
    updateStatusesRef.current = updateStatuses;

    const { prefs, updatePrefs } = useFleetPreferences();
    const { fleetPalette, fleetStackLabelMap, labelFilters, setLabelFilters } = useFleetLabels({ isPaid, nodes });

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

    const clearFilters = useCallback(() => {
        updatePrefs({ filterStatus: 'all', filterType: 'all', filterCritical: false });
        setLabelFilters(new Set());
    }, [updatePrefs, setLabelFilters]);
    const allNodes = useMemo(
        () => (localNode ? [localNode, ...remoteNodes] : remoteNodes),
        [localNode, remoteNodes]
    );

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
                            {isAdmiral && experimental && (
                                <TabsHighlightItem value="routing">
                                    <TabsTrigger value="routing">
                                        <ArrowLeftRight className="w-4 h-4 mr-1.5" />Traffic · Routing
                                    </TabsTrigger>
                                </TabsHighlightItem>
                            )}
                            <TabsHighlightItem value="configuration">
                                <TabsTrigger value="configuration">
                                    <SlidersHorizontal className="w-4 h-4 mr-1.5" />Status
                                </TabsTrigger>
                            </TabsHighlightItem>
                            {experimental && (
                                <>
                                    <span aria-hidden className="self-center mx-1 h-4 w-px bg-border" />
                                    <TabsHighlightItem value="deployments">
                                        <TabsTrigger value="deployments">
                                            <Send className="w-4 h-4 mr-1.5" />Deployments
                                            {!isPaid && <SoonBadge />}
                                        </TabsTrigger>
                                    </TabsHighlightItem>
                                    <TabsHighlightItem value="federation">
                                        <TabsTrigger value="federation">
                                            <Network className="w-4 h-4 mr-1.5" />Federation
                                            <SoonBadge />
                                        </TabsTrigger>
                                    </TabsHighlightItem>
                                    <TabsHighlightItem value="secrets">
                                        <TabsTrigger value="secrets">
                                            <KeyRound className="w-4 h-4 mr-1.5" />Secrets
                                            <SoonBadge />
                                        </TabsTrigger>
                                    </TabsHighlightItem>
                                </>
                            )}
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
                    <OverviewTab
                        loading={loading}
                        nodes={nodes}
                        processedNodes={processedNodes}
                        allNodes={allNodes}
                        topologyNodes={topologyNodes}
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        prefs={prefs}
                        onPrefsChange={updatePrefs}
                        fleetPalette={fleetPalette}
                        labelFilters={labelFilters}
                        onLabelFiltersChange={setLabelFilters}
                        onClearFilters={clearFilters}
                        isPaid={isPaid}
                        fleetStackLabelMap={fleetStackLabelMap}
                        updateStatusMap={updateStatusMap}
                        onNavigateToNode={onNavigateToNode}
                        onUpdate={isPaid ? triggerNodeUpdate : undefined}
                        updatingNodeId={updatingNodeId}
                        onRetryUpdate={isPaid ? retryNodeUpdate : undefined}
                        onDismissUpdate={isPaid ? dismissNodeUpdate : undefined}
                    />
                </TabsContent>

                {isPaid && (
                    <TabsContent value="snapshots">
                        <FleetSnapshots />
                    </TabsContent>
                )}
                {isAdmiral && experimental && (
                    <TabsContent value="routing">
                        <AdmiralGate>
                            <RoutingTab />
                        </AdmiralGate>
                    </TabsContent>
                )}
                <TabsContent value="configuration">
                    <FleetConfiguration />
                </TabsContent>
                {experimental && (
                    <>
                        <TabsContent value="deployments">
                            {isPaid ? (
                                <DeploymentsTab />
                            ) : (
                                <FleetSoonPlaceholder
                                    icon={<Send className="h-4 w-4" />}
                                    kicker="Deployments · Blueprints"
                                    title="Declare once. Distribute everywhere."
                                    description="Pick nodes by label, drop in a docker-compose, and Sencho keeps the matching nodes in sync. Drift detection always on; auto-fix optional."
                                    plannedActions={['Author', 'Target', 'Reconcile', 'Snapshot+evict']}
                                />
                            )}
                        </TabsContent>
                        <TabsContent value="federation">
                            <FleetSoonPlaceholder
                                icon={<Network className="h-4 w-4" />}
                                kicker="Federation · Coming soon"
                                title="The fleet as one logical surface"
                                description="Pin policies, drain a node for maintenance, weight-aware scheduling. This stack runs on whichever node has capacity."
                                plannedActions={['Pin policy', 'Drain node', 'Cordon', 'Capacity plan']}
                            />
                        </TabsContent>
                        <TabsContent value="secrets">
                            <FleetSoonPlaceholder
                                icon={<KeyRound className="h-4 w-4" />}
                                kicker="Secrets · Coming soon"
                                title="One source of truth for env, creds and certs"
                                description="Push to selected nodes, rotate centrally, audit who-saw-what. Solves silent drift across copies."
                                plannedActions={['Sync env', 'Rotate', 'Audit', 'Pin to nodes']}
                            />
                        </TabsContent>
                    </>
                )}
            </Tabs>

            {/* Reconnecting overlay shown when local node is updating */}
            {reconnecting && <ReconnectingOverlay preUpdateStartedAt={preUpdateStartedAt} />}

            {/* Node Updates sheet */}
            <NodeUpdatesSheet
                open={showUpdateModal}
                onOpenChange={setShowUpdateModal}
                checkingUpdates={checkingUpdates}
                updateStatuses={updateStatuses}
                updatingNodeId={updatingNodeId}
                fetchUpdateStatus={fetchUpdateStatus}
                triggerNodeUpdate={triggerNodeUpdate}
                retryNodeUpdate={retryNodeUpdate}
                dismissNodeUpdate={dismissNodeUpdate}
                triggerUpdateAll={triggerUpdateAll}
            />

            {/* Confirm dialog for local node update */}
            <LocalUpdateConfirmDialog
                open={localUpdateConfirm !== null}
                onOpenChange={(open) => { if (!open) setLocalUpdateConfirm(null); }}
                onConfirm={confirmLocalUpdate}
            />
        </div>
    );
}
