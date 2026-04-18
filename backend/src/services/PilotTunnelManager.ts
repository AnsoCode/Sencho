import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { PilotTunnelBridge } from './PilotTunnelBridge';
import { DatabaseService } from './DatabaseService';
import { PilotCloseCode } from '../pilot/protocol';

/**
 * PilotTunnelManager: singleton registry of active pilot tunnels.
 *
 * Each enrolled pilot-agent node holds one outbound WebSocket to the primary.
 * For every such tunnel we spin up a local loopback HTTP server that demuxes
 * requests into frames. Remote-proxy code paths (http-proxy-middleware and the
 * WebSocket upgrade handler) can then treat pilot nodes identically to standard
 * proxy nodes by pointing at the loopback URL.
 *
 * Events:
 *   - 'tunnel-up'   (nodeId: number) after a tunnel is accepted
 *   - 'tunnel-down' (nodeId: number) after a tunnel closes (for any reason)
 */
export class PilotTunnelManager extends EventEmitter {
    private static instance: PilotTunnelManager;
    private bridges: Map<number, PilotTunnelBridge> = new Map();

    private constructor() {
        super();
        this.setMaxListeners(50);
    }

    public static getInstance(): PilotTunnelManager {
        if (!PilotTunnelManager.instance) {
            PilotTunnelManager.instance = new PilotTunnelManager();
        }
        return PilotTunnelManager.instance;
    }

    /**
     * Accept a newly handshaked pilot tunnel. Replaces any prior tunnel for the
     * same node (split-brain prevention): the previous bridge is closed
     * before the new one is installed.
     *
     * Resolves once the loopback HTTP server is listening.
     */
    public async registerTunnel(nodeId: number, ws: WebSocket, agentVersion?: string): Promise<void> {
        const existing = this.bridges.get(nodeId);
        if (existing) {
            existing.close(PilotCloseCode.Replaced, 'replaced by newer tunnel');
            this.bridges.delete(nodeId);
        }

        const bridge = new PilotTunnelBridge(nodeId, ws);
        bridge.once('closed', () => {
            if (this.bridges.get(nodeId) === bridge) {
                this.bridges.delete(nodeId);
                DatabaseService.getInstance().updateNodeStatus(nodeId, 'offline');
                this.emit('tunnel-down', nodeId);
            }
        });
        await bridge.start();

        this.bridges.set(nodeId, bridge);
        const db = DatabaseService.getInstance();
        db.updateNodeStatus(nodeId, 'online');
        db.updateNode(nodeId, {
            pilot_last_seen: Date.now(),
            pilot_agent_version: agentVersion ?? null,
        });
        this.emit('tunnel-up', nodeId);
    }

    /**
     * Return the loopback base URL (http://127.0.0.1:PORT) for a node's active
     * tunnel, or null if no tunnel is currently registered.
     */
    public getLoopbackUrl(nodeId: number): string | null {
        const bridge = this.bridges.get(nodeId);
        return bridge ? bridge.getLoopbackUrl() : null;
    }

    /**
     * True if a tunnel for this node is registered and healthy.
     */
    public hasActiveTunnel(nodeId: number): boolean {
        return this.bridges.has(nodeId);
    }

    /**
     * Force-close a tunnel (e.g., on node deletion).
     */
    public closeTunnel(nodeId: number, code = 1000, reason = 'closed by primary'): void {
        const bridge = this.bridges.get(nodeId);
        if (!bridge) return;
        bridge.close(code, reason);
        this.bridges.delete(nodeId);
    }

    /**
     * Snapshot of currently active tunnels.
     */
    public listActive(): Array<{ nodeId: number; loopbackUrl: string; connectedAt: number }> {
        return Array.from(this.bridges.entries()).map(([nodeId, bridge]) => ({
            nodeId,
            loopbackUrl: bridge.getLoopbackUrl(),
            connectedAt: bridge.getConnectedAt(),
        }));
    }

    /**
     * Record an application-level heartbeat from the agent.
     */
    public touch(nodeId: number): void {
        if (!this.bridges.has(nodeId)) return;
        DatabaseService.getInstance().updateNode(nodeId, { pilot_last_seen: Date.now() });
    }
}
