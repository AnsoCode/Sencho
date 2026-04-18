import { useMemo } from 'react';
import { Server } from 'lucide-react';

interface TopologyNode {
  id: number;
  name: string;
  type: 'local' | 'remote';
  status: 'online' | 'offline' | 'unknown';
  cpuPercent: number;
  memPercent: number;
  critical: boolean;
}

interface FleetTopologyProps {
  nodes: TopologyNode[];
  onNodeClick?: (nodeId: number) => void;
}

interface Positioned {
  node: TopologyNode;
  x: number;
  y: number;
}

const LOCAL_X = 140;
const LOCAL_Y = 260;
const REMOTE_X_START = 460;
const REMOTE_X_STEP = 220;
const REMOTE_Y_AMPLITUDE = 160;
const CANVAS_WIDTH = 1180;
const CANVAS_HEIGHT = 520;

function layoutRemotes(remotes: TopologyNode[]): Positioned[] {
  if (remotes.length === 0) return [];
  const positioned: Positioned[] = [];
  const cols = Math.min(3, Math.max(1, Math.ceil(remotes.length / 3)));
  const perCol = Math.ceil(remotes.length / cols);
  for (let i = 0; i < remotes.length; i += 1) {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = REMOTE_X_START + col * REMOTE_X_STEP;
    const yCenter = LOCAL_Y;
    const offset = perCol === 1
      ? 0
      : (row - (perCol - 1) / 2) * (REMOTE_Y_AMPLITUDE / Math.max(1, perCol - 1)) * 2;
    positioned.push({ node: remotes[i], x, y: yCenter + offset });
  }
  return positioned;
}

function linkClass(node: TopologyNode): string {
  if (node.status !== 'online') return 'stroke-destructive/40';
  if (node.critical) return 'stroke-warning/60';
  return 'stroke-brand/40';
}

function dotClass(node: TopologyNode): string {
  if (node.status !== 'online') return 'bg-destructive';
  if (node.critical) return 'bg-warning';
  return 'bg-success';
}

export function FleetTopology({ nodes, onNodeClick }: FleetTopologyProps) {
  const local = useMemo(() => nodes.find(n => n.type === 'local') ?? null, [nodes]);
  const remotes = useMemo(() => layoutRemotes(nodes.filter(n => n.type === 'remote')), [nodes]);

  if (!local && remotes.length === 0) {
    return (
      <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-10 text-center">
        <p className="text-sm text-stat-subtitle">No nodes to plot.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-4">
      <div className="relative overflow-hidden rounded-md" style={{ height: CANVAS_HEIGHT }}>
        <svg
          viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {local
            ? remotes.map(r => (
                <line
                  key={`link-${r.node.id}`}
                  x1={LOCAL_X + 48}
                  y1={LOCAL_Y}
                  x2={r.x}
                  y2={r.y}
                  strokeWidth={1}
                  strokeDasharray={r.node.status === 'online' ? undefined : '4 4'}
                  className={linkClass(r.node)}
                />
              ))
            : null}
        </svg>

        {local ? (
          <NodeChip
            node={local}
            x={LOCAL_X}
            y={LOCAL_Y}
            size="lg"
            canvasWidth={CANVAS_WIDTH}
            canvasHeight={CANVAS_HEIGHT}
            onClick={onNodeClick}
          />
        ) : null}
        {remotes.map(r => (
          <NodeChip
            key={r.node.id}
            node={r.node}
            x={r.x}
            y={r.y}
            size="md"
            canvasWidth={CANVAS_WIDTH}
            canvasHeight={CANVAS_HEIGHT}
            onClick={onNodeClick}
          />
        ))}
      </div>
    </div>
  );
}

interface NodeChipProps {
  node: TopologyNode;
  x: number;
  y: number;
  size: 'md' | 'lg';
  canvasWidth: number;
  canvasHeight: number;
  onClick?: (nodeId: number) => void;
}

function NodeChip({ node, x, y, size, canvasWidth, canvasHeight, onClick }: NodeChipProps) {
  const isLg = size === 'lg';
  const width = isLg ? 200 : 180;
  const height = isLg ? 96 : 80;
  const isLocal = node.type === 'local';
  return (
    <button
      type="button"
      onClick={() => onClick?.(node.id)}
      className={`absolute flex flex-col items-start gap-1 rounded-lg border border-card-border border-t-card-border-top bg-card px-3 py-2 text-left shadow-card-bevel transition-colors hover:border-t-card-border-hover ${isLocal ? 'ring-1 ring-brand/40' : ''}`}
      style={{
        left: `${((x - width / 2) / canvasWidth) * 100}%`,
        top: `${((y - height / 2) / canvasHeight) * 100}%`,
        width,
        height,
      }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass(node)}`} />
        <Server className="h-3.5 w-3.5 text-stat-icon" strokeWidth={1.5} />
        <span className="font-mono text-xs text-stat-value truncate">{node.name}</span>
        {isLocal ? (
          <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.22em] text-brand">Local</span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums text-stat-subtitle">
        <span>CPU {node.cpuPercent.toFixed(0)}%</span>
        <span className="text-stat-icon">·</span>
        <span>MEM {node.memPercent.toFixed(0)}%</span>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle/80">
        {node.status === 'online' ? (node.critical ? 'critical' : 'online') : 'offline'}
      </div>
    </button>
  );
}
