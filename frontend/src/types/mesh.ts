export type MeshRoutePillState = 'healthy' | 'degraded' | 'unreachable' | 'tunnel-down' | 'not-authorized';

export interface MeshAlias {
    host: string;
    nodeId: number;
    nodeName: string;
    stackName: string;
    serviceName: string;
    port: number;
}

export interface MeshNodeStatus {
    nodeId: number;
    nodeName: string;
    enabled: boolean;
    sidecarRunning: boolean;
    pilotConnected: boolean;
    optedInStacks: string[];
    activeStreamCount: number;
}

export interface MeshRouteDiagnostic {
    alias: string;
    target: {
        nodeId: number;
        stack: string;
        service: string;
        port: number;
        alias: string;
    } | null;
    pilot: { connected: boolean; lastSeen: number | null };
    lastError: { ts: number; message: string } | null;
    lastProbeMs: number | null;
    state: 'healthy' | 'degraded' | 'unreachable' | 'tunnel down' | 'not authorized';
}

export interface MeshNodeDiagnostic {
    nodeId: number;
    sidecar: { running: boolean; restartCount: number };
    pilot: { connected: boolean; bufferedAmount: number; lastSeen: number | null };
    activeStreams: Array<{ streamId: number; alias?: string; bytesIn: number; bytesOut: number; ageMs: number }>;
    aliasCache: Array<{ host: string; targetNodeId: number; port: number }>;
}

export interface MeshProbeResult {
    ok: boolean;
    latencyMs?: number;
    where?: 'sidecar' | 'pilot_tunnel' | 'agent_resolve' | 'agent_dial' | 'target_port';
    code?: string;
    message?: string;
}

export interface MeshActivityEvent {
    ts: number;
    source: 'sidecar' | 'pilot' | 'mesh';
    level: 'info' | 'warn' | 'error';
    type: string;
    nodeId?: number;
    alias?: string;
    streamId?: number;
    message: string;
    details?: Record<string, unknown>;
}

export interface MeshStackEntry {
    name: string;
    optedIn: boolean;
}
