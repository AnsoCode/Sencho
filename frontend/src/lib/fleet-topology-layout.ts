import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

export interface FleetTopologyNode {
    id: number;
    name: string;
    type: 'local' | 'remote';
    status: 'online' | 'offline' | 'unknown';
    cpuPercent: number;
    memPercent: number;
    diskPercent: number;
    stackCount: number;
    runningCount: number;
    critical: boolean;
}

export interface FleetNodeData extends Record<string, unknown> {
    node: FleetTopologyNode;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 150;

// ReactFlow inline styles cannot resolve CSS custom properties, so raw oklch
// values are used. Values match the design tokens in frontend/src/index.css.
const EDGE_BRAND = 'oklch(0.78 0.11 195)';
const EDGE_WARNING = 'oklch(0.75 0.14 75)';
const EDGE_MUTED = 'oklch(0.55 0 0)';

function edgeStyle(remote: FleetTopologyNode): {
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string;
} {
    if (remote.status !== 'online') {
        return { stroke: EDGE_MUTED, strokeWidth: 1, strokeDasharray: '4 4' };
    }
    if (remote.critical) {
        return { stroke: EDGE_WARNING, strokeWidth: 1.5 };
    }
    return { stroke: EDGE_BRAND, strokeWidth: 1.5 };
}

export function layoutFleetGraph(
    fleetNodes: FleetTopologyNode[],
): { nodes: Node[]; edges: Edge[] } {
    if (fleetNodes.length === 0) return { nodes: [], edges: [] };

    const local = fleetNodes.find(n => n.type === 'local') ?? null;
    const remotes = fleetNodes.filter(n => n.type !== 'local');

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', ranksep: 160, nodesep: 32, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of fleetNodes) {
        g.setNode(String(n.id), { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    if (local) {
        for (const r of remotes) {
            g.setEdge(String(local.id), String(r.id));
        }
    }

    dagre.layout(g);

    const flowNodes: Node[] = fleetNodes.map(n => {
        const pos = g.node(String(n.id));
        return {
            id: String(n.id),
            type: 'fleetNode',
            position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
            data: { node: n } satisfies FleetNodeData,
            draggable: true,
        };
    });

    const flowEdges: Edge[] = local
        ? remotes.map(r => ({
            id: `edge-${local.id}-${r.id}`,
            source: String(local.id),
            target: String(r.id),
            style: edgeStyle(r),
            animated: false,
        }))
        : [];

    return { nodes: flowNodes, edges: flowEdges };
}
