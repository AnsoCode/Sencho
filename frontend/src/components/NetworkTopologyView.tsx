import { useState, useEffect, useCallback } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type NodeTypes,
    Handle,
    Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { Container, Network, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DockerNetwork {
    Id: string;
    Name: string;
    Driver: string;
    Scope: string;
    managedBy: string | null;
    managedStatus: 'managed' | 'unmanaged' | 'system';
}

interface NetworkInspect {
    Id: string;
    Name: string;
    Driver: string;
    Containers: Record<string, {
        Name: string;
        IPv4Address: string;
    }>;
}

interface ContainerNode {
    id: string;
    name: string;
    networks: string[];
    ipAddresses: Record<string, string>;
}

interface NetworkTopologyViewProps {
    networks: DockerNetwork[];
}

// ── Custom Nodes ──────────────────────────────────────────────────────────────

function ContainerNodeComponent({ data }: { data: { label: string; networks: string[]; ipAddresses: Record<string, string> } }) {
    return (
        <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel px-3 py-2 min-w-[160px]">
            <Handle type="target" position={Position.Top} className="!bg-muted-foreground !w-2 !h-2" />
            <div className="flex items-center gap-2 mb-1.5">
                <Container className="w-3.5 h-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                <span className="text-xs font-medium truncate max-w-[140px]">{data.label}</span>
            </div>
            {data.networks.length > 0 && (
                <div className="space-y-0.5">
                    {data.networks.map(netName => (
                        <div key={netName} className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{netName}</span>
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                                {data.ipAddresses[netName]?.replace(/\/\d+$/, '') || ''}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground !w-2 !h-2" />
        </div>
    );
}

function NetworkNodeComponent({ data }: { data: { label: string; driver: string; status: string } }) {
    const statusColor = data.status === 'managed' ? 'text-success' : data.status === 'system' ? 'text-muted-foreground' : 'text-warning';
    return (
        <div className={cn(
            'rounded-lg border-2 border-dashed px-4 py-2.5 min-w-[140px] text-center',
            data.status === 'managed' ? 'border-success/30 bg-success/5' :
                data.status === 'system' ? 'border-muted-foreground/20 bg-muted/20' :
                    'border-warning/30 bg-warning/5'
        )}>
            <Handle type="target" position={Position.Top} className="!bg-transparent !border-none !w-0 !h-0" />
            <div className="flex items-center justify-center gap-1.5 mb-1">
                <Network className={cn('w-3.5 h-3.5', statusColor)} strokeWidth={1.5} />
                <span className="text-xs font-medium">{data.label}</span>
            </div>
            <Badge variant="outline" className="text-[9px] h-4">{data.driver}</Badge>
            <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-none !w-0 !h-0" />
        </div>
    );
}

const nodeTypes: NodeTypes = {
    container: ContainerNodeComponent,
    network: NetworkNodeComponent,
};

// React Flow's inline style objects cannot resolve CSS custom properties,
// so raw oklch values are used here as a necessary escape hatch.
const EDGE_COLORS = [
    'oklch(0.75 0.08 192)', // brand teal
    'oklch(0.70 0.10 150)', // green
    'oklch(0.70 0.10 280)', // purple
    'oklch(0.70 0.10 30)',  // orange
    'oklch(0.70 0.10 220)', // blue
    'oklch(0.70 0.10 340)', // pink
];

// ── Layout Helper ─────────────────────────────────────────────────────────────

function layoutGraph(
    networksList: Array<DockerNetwork & { containers: Array<{ id: string; name: string; ip: string }> }>,
): { nodes: Node[]; edges: Edge[] } {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];
    const containerDataMap = new Map<string, ContainerNode>();

    networksList.forEach(net => {
        net.containers.forEach(c => {
            if (!containerDataMap.has(c.id)) {
                containerDataMap.set(c.id, { id: c.id, name: c.name, networks: [], ipAddresses: {} });
            }
            const cd = containerDataMap.get(c.id)!;
            cd.networks.push(net.Name);
            cd.ipAddresses[net.Name] = c.ip;
        });
    });

    const networkSpacing = 240;
    const containerSpacing = 220;

    networksList.forEach((net, i) => {
        flowNodes.push({
            id: `net-${net.Id}`,
            type: 'network',
            position: { x: i * networkSpacing, y: 0 },
            data: { label: net.Name, driver: net.Driver, status: net.managedStatus },
            draggable: true,
        });
    });

    const allContainers = Array.from(containerDataMap.values());
    allContainers.forEach((container, i) => {
        flowNodes.push({
            id: `ctr-${container.id}`,
            type: 'container',
            position: { x: i * containerSpacing, y: 180 },
            data: {
                label: container.name,
                networks: container.networks,
                ipAddresses: container.ipAddresses,
            },
            draggable: true,
        });
    });

    networksList.forEach((net, ni) => {
        const color = EDGE_COLORS[ni % EDGE_COLORS.length];
        net.containers.forEach(c => {
            flowEdges.push({
                id: `edge-${net.Id}-${c.id}`,
                source: `net-${net.Id}`,
                target: `ctr-${c.id}`,
                animated: true,
                style: { stroke: color, strokeWidth: 1.5 },
            });
        });
    });

    return { nodes: flowNodes, edges: flowEdges };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NetworkTopologyView({ networks }: NetworkTopologyViewProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [loading, setLoading] = useState(true);

    const fetchTopology = useCallback(async () => {
        setLoading(true);
        try {
            const userNetworks = networks.filter(n => n.managedStatus !== 'system');

            const inspected = await Promise.all(
                userNetworks.map(async net => {
                    try {
                        const inspectRes = await apiFetch(`/system/networks/${net.Id}`);
                        if (!inspectRes.ok) return { ...net, containers: [] as Array<{ id: string; name: string; ip: string }> };
                        const detail: NetworkInspect = await inspectRes.json();
                        const containers = Object.entries(detail.Containers || {}).map(([id, c]) => ({
                            id,
                            name: c.Name,
                            ip: c.IPv4Address,
                        }));
                        return { ...net, containers };
                    } catch {
                        return { ...net, containers: [] as Array<{ id: string; name: string; ip: string }> };
                    }
                })
            );

            const { nodes: layoutNodes, edges: layoutEdges } = layoutGraph(inspected);
            setNodes(layoutNodes);
            setEdges(layoutEdges);
        } catch (error: any) {
            toast.error(error?.message || error?.error || error?.data?.error || 'Something went wrong.');
        } finally {
            setLoading(false);
        }
    }, [networks, setNodes, setEdges]);

    useEffect(() => { fetchTopology(); }, [fetchTopology]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[400px] text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                <span className="text-sm">Loading network topology...</span>
            </div>
        );
    }

    if (nodes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground gap-3">
                <Network className="w-8 h-8 opacity-40" strokeWidth={1.5} />
                <p className="text-sm">No user-created networks found.</p>
                <p className="text-xs opacity-70">Create a network or deploy stacks with custom networks to see the topology.</p>
            </div>
        );
    }

    return (
        <div className="h-[500px] w-full rounded-lg border border-card-border bg-card shadow-card-bevel overflow-hidden">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
                className="bg-background"
            >
                <Background gap={20} size={1} className="opacity-30" />
                <Controls className="!bg-card !border-card-border !shadow-card-bevel [&>button]:!bg-card [&>button]:!border-card-border [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
                <MiniMap
                    className="!bg-card !border-card-border !shadow-card-bevel"
                    nodeColor={(node) => {
                        if (node.type === 'network') return 'oklch(0.75 0.08 192)';
                        return 'oklch(0.50 0 0)';
                    }}
                    maskColor="oklch(0 0 0 / 0.2)"
                />
            </ReactFlow>
        </div>
    );
}
