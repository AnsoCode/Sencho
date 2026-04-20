import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Handle,
    Position,
    type Node,
    type Edge,
    type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Server, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    layoutFleetGraph,
    type FleetNodeData,
    type FleetTopologyNode,
} from '@/lib/fleet-topology-layout';

interface FleetTopologyProps {
    nodes: FleetTopologyNode[];
    onNodeClick?: (nodeId: number) => void;
}

// Raw oklch values for MiniMap coloring (ReactFlow cannot resolve CSS vars
// inside inline styles / SVG fills).
const MINIMAP_BRAND = 'oklch(0.78 0.11 195)';
const MINIMAP_WARNING = 'oklch(0.75 0.14 75)';
const MINIMAP_MUTED = 'oklch(0.55 0 0)';

function dotClass(node: FleetTopologyNode): string {
    if (node.status !== 'online') return 'bg-destructive';
    if (node.critical) return 'bg-warning';
    return 'bg-success';
}

function barColor(value: number): string {
    if (value >= 85) return 'bg-destructive';
    if (value >= 60) return 'bg-warning';
    return 'bg-brand';
}

function MetricBar({ label, value, muted }: { label: string; value: number; muted: boolean }) {
    const clamped = Math.max(0, Math.min(100, value));
    return (
        <div className="flex items-center gap-2">
            <span className="w-9 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                {label}
            </span>
            <div className="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
                <div
                    className={cn('h-full rounded-full transition-[width] duration-300', muted ? 'bg-muted-foreground/40' : barColor(value))}
                    style={{ width: `${clamped}%` }}
                />
            </div>
            <span className="w-8 text-right font-mono text-[10px] tabular-nums text-stat-value">
                {Math.round(clamped)}%
            </span>
        </div>
    );
}

function FleetNodeCard({ data, selected }: { data: FleetNodeData; selected?: boolean }) {
    const node = data.node;
    const isLocal = node.type === 'local';
    const isOffline = node.status !== 'online';
    const stackLabel = node.stackCount === 1 ? 'stack' : 'stacks';

    return (
        <div
            className={cn(
                'w-[240px] rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel transition-colors',
                'hover:border-t-card-border-hover cursor-pointer',
                isLocal && 'ring-1 ring-brand/40',
                isOffline && 'opacity-70',
                selected && 'ring-1 ring-brand',
            )}
        >
            <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-1.5 !h-1.5 !border-0" />

            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-card-border">
                <span aria-hidden="true" className={cn('h-2 w-2 rounded-full shrink-0', dotClass(node))} />
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                    {isOffline ? 'Offline' : node.critical ? 'Critical' : 'Online'}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                    {node.critical && !isOffline ? (
                        <Zap className="h-3 w-3 text-warning" strokeWidth={2} aria-label="Critical" />
                    ) : null}
                    <span className={cn(
                        'font-mono text-[9px] uppercase tracking-[0.22em]',
                        isLocal ? 'text-brand' : 'text-muted-foreground',
                    )}>
                        {isLocal ? 'Local' : 'Remote'}
                    </span>
                </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-card-border">
                <Server className="h-3.5 w-3.5 text-stat-icon shrink-0" strokeWidth={1.5} />
                <span className="text-xs font-medium text-stat-value truncate">{node.name}</span>
            </div>

            <div className="px-3 py-2 space-y-1 border-b border-card-border">
                <MetricBar label="CPU" value={node.cpuPercent} muted={isOffline} />
                <MetricBar label="MEM" value={node.memPercent} muted={isOffline} />
                <MetricBar label="DISK" value={node.diskPercent} muted={isOffline} />
            </div>

            <div className="px-3 py-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {node.stackCount} {stackLabel} · {node.runningCount} running
            </div>

            <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-1.5 !h-1.5 !border-0" />
        </div>
    );
}

const nodeTypes: NodeTypes = {
    fleetNode: FleetNodeCard,
};

export function FleetTopology({ nodes: fleetNodes, onNodeClick }: FleetTopologyProps) {
    const onNodeClickRef = useRef(onNodeClick);
    onNodeClickRef.current = onNodeClick;

    // Only re-layout when the topology *shape* changes (nodes added/removed,
    // type or status flips). Metric value changes alone must not snap
    // user-dragged nodes back to the dagre-computed positions on every poll.
    const shapeKey = useMemo(
        () => fleetNodes.map(n => `${n.id}:${n.type}:${n.status}`).sort().join('|'),
        [fleetNodes],
    );

    const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
    const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);

    useEffect(() => {
        const { nodes: nextNodes, edges: nextEdges } = layoutFleetGraph(fleetNodes);
        setFlowNodes(nextNodes);
        setFlowEdges(nextEdges);
        // fleetNodes is intentionally excluded: we only relayout on shape changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shapeKey, setFlowNodes, setFlowEdges]);

    // Update live metrics on every poll without resetting positions.
    useEffect(() => {
        setFlowNodes(current => current.map(flowNode => {
            const next = fleetNodes.find(n => String(n.id) === flowNode.id);
            if (!next) return flowNode;
            const existing = (flowNode.data as FleetNodeData | undefined)?.node;
            if (existing && existing.cpuPercent === next.cpuPercent
                && existing.memPercent === next.memPercent
                && existing.diskPercent === next.diskPercent
                && existing.stackCount === next.stackCount
                && existing.runningCount === next.runningCount
                && existing.critical === next.critical) {
                return flowNode;
            }
            return { ...flowNode, data: { node: next } satisfies FleetNodeData };
        }));
    }, [fleetNodes, setFlowNodes]);

    const handleNodeClick = useCallback((_event: React.MouseEvent, flowNode: Node) => {
        const id = Number(flowNode.id);
        if (!Number.isNaN(id)) {
            onNodeClickRef.current?.(id);
        }
    }, []);

    const miniMapNodeColor = useCallback((n: Node) => {
        const data = n.data as FleetNodeData | undefined;
        const topo = data?.node;
        if (!topo || topo.status !== 'online') return MINIMAP_MUTED;
        if (topo.critical) return MINIMAP_WARNING;
        return MINIMAP_BRAND;
    }, []);

    if (fleetNodes.length === 0) {
        return (
            <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-10 text-center">
                <p className="text-sm text-muted-foreground">No nodes to plot.</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel overflow-hidden">
            <div className="h-[560px] w-full">
                <ReactFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeClick={handleNodeClick}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    proOptions={{ hideAttribution: true }}
                    nodesConnectable={false}
                    className="bg-background"
                >
                    <Background gap={20} size={1} className="opacity-30" />
                    <Controls
                        className="!bg-card !border-card-border !shadow-card-bevel [&>button]:!bg-card [&>button]:!border-card-border [&>button]:!text-foreground [&>button:hover]:!bg-muted"
                        showInteractive={false}
                    />
                    <MiniMap
                        className="!bg-card !border-card-border !shadow-card-bevel"
                        nodeColor={miniMapNodeColor}
                        maskColor="oklch(0 0 0 / 0.2)"
                        pannable
                        zoomable
                    />
                </ReactFlow>
            </div>
        </div>
    );
}
