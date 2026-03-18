import Docker from 'dockerode';
import { DatabaseService, Node } from './DatabaseService';

/**
 * NodeRegistry: Manages Docker daemon connections for multiple nodes.
 * Replaces the old singleton DockerController pattern. Each node
 * (local or remote) gets its own dedicated Docker client instance.
 */
export class NodeRegistry {
    private static instance: NodeRegistry;
    private connections: Map<number, Docker> = new Map();

    private constructor() {}

    public static getInstance(): NodeRegistry {
        if (!NodeRegistry.instance) {
            NodeRegistry.instance = new NodeRegistry();
        }
        return NodeRegistry.instance;
    }

    /**
     * Get a Docker client for a specific node.
     * Creates the connection lazily on first request and caches it.
     */
    public getDocker(nodeId: number): Docker {
        // Return cached connection if available
        if (this.connections.has(nodeId)) {
            return this.connections.get(nodeId)!;
        }

        const db = DatabaseService.getInstance();
        const node = db.getNode(nodeId);

        if (!node) {
            throw new Error(`Node with id ${nodeId} not found`);
        }

        const docker = this.createDockerClient(node);
        this.connections.set(nodeId, docker);
        return docker;
    }

    /**
     * Get the Docker client for the default node.
     * This is the backward-compatible path for all existing code.
     */
    public getDefaultDocker(): Docker {
        const db = DatabaseService.getInstance();
        const defaultNode = db.getDefaultNode();

        if (!defaultNode || !defaultNode.id) {
            // Absolute fallback: local socket (preserves legacy behavior)
            return new Docker();
        }

        return this.getDocker(defaultNode.id);
    }

    /**
     * Get the default node ID. Returns the ID of the node marked as default.
     */
    public getDefaultNodeId(): number {
        const db = DatabaseService.getInstance();
        const defaultNode = db.getDefaultNode();
        return defaultNode?.id || 1;
    }

    /**
     * Create a Docker client based on node configuration.
     * - Local nodes: use the default socket (Docker autodetects)
     * - Remote nodes: connect via TCP to host:port
     */
    private createDockerClient(node: Node): Docker {
        if (node.type === 'local') {
            // Local node: use the default Docker socket
            return new Docker();
        }

        // Remote node: connect via Docker TCP API
        if (!node.host) {
            throw new Error(`Remote node "${node.name}" is missing a host address`);
        }

        return new Docker({
            host: node.host,
            port: node.port || 2375,
            // TODO: Phase 55.2 — Add TLS certificate support for secure remote connections
        });
    }

    /**
     * Test connectivity to a specific node.
     * Returns true if we can ping the Docker daemon.
     */
    public async testConnection(nodeId: number): Promise<{ success: boolean; error?: string; info?: any }> {
        const db = DatabaseService.getInstance();
        const node = db.getNode(nodeId);

        if (!node) {
            return { success: false, error: 'Node not found' };
        }

        try {
            const docker = this.createDockerClient(node);
            const info = await docker.info();
            db.updateNodeStatus(nodeId, 'online');
            return {
                success: true,
                info: {
                    name: info.Name,
                    serverVersion: info.ServerVersion,
                    os: info.OperatingSystem,
                    architecture: info.Architecture,
                    containers: info.Containers,
                    containersRunning: info.ContainersRunning,
                    images: info.Images,
                    memTotal: info.MemTotal,
                    cpus: info.NCPU,
                }
            };
        } catch (error: any) {
            db.updateNodeStatus(nodeId, 'offline');
            return { success: false, error: error.message || 'Connection failed' };
        }
    }

    /**
     * Evict a cached connection (e.g., after node config changes).
     */
    public evictConnection(nodeId: number): void {
        this.connections.delete(nodeId);
    }

    /**
     * Flush all cached connections.
     */
    public flushAll(): void {
        this.connections.clear();
    }

    /**
     * Get the compose directory for a specific node.
     */
    public getComposeDir(nodeId: number): string {
        const db = DatabaseService.getInstance();
        const node = db.getNode(nodeId);
        return node?.compose_dir || process.env.COMPOSE_DIR || '/app/compose';
    }
}
