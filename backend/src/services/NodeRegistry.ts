import Docker from 'dockerode';
import axios from 'axios';
import { DatabaseService, Node } from './DatabaseService';

/**
 * NodeRegistry: Manages connections for multiple nodes.
 *
 * In the Distributed API model:
 * - Local nodes: direct Docker socket connection via Dockerode (unchanged)
 * - Remote nodes: HTTP/WS proxy to a remote Sencho instance (api_url + api_token)
 *   No direct Docker TCP connections are made for remote nodes.
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
     * Get a Docker client for a LOCAL node only.
     * Remote nodes are never accessed via Dockerode — use the HTTP proxy instead.
     */
    public getDocker(nodeId: number): Docker {
        if (this.connections.has(nodeId)) {
            return this.connections.get(nodeId)!;
        }

        const db = DatabaseService.getInstance();
        const node = db.getNode(nodeId);

        if (!node) {
            throw new Error(`Node with id ${nodeId} not found`);
        }

        if (node.type === 'remote') {
            throw new Error(
                `Node "${node.name}" is a remote Distributed API node. ` +
                `Its Docker daemon is not directly accessible — all requests are proxied via HTTP.`
            );
        }

        const docker = new Docker();
        this.connections.set(nodeId, docker);
        return docker;
    }

    /**
     * Get the Docker client for the default node.
     * Backward-compatible path for local-node code.
     */
    public getDefaultDocker(): Docker {
        const db = DatabaseService.getInstance();
        const defaultNode = db.getDefaultNode();

        if (!defaultNode || !defaultNode.id) {
            return new Docker();
        }

        return this.getDocker(defaultNode.id);
    }

    /**
     * Get the default node ID.
     */
    public getDefaultNodeId(): number {
        const db = DatabaseService.getInstance();
        const defaultNode = db.getDefaultNode();
        return defaultNode?.id || 1;
    }

    /**
     * Get a node configuration by its ID.
     */
    public getNode(nodeId: number): Node | undefined {
        const db = DatabaseService.getInstance();
        return db.getNode(nodeId);
    }

    /**
     * Get the HTTP proxy target for a remote node.
     * Returns { apiUrl, apiToken } for use by the HTTP proxy middleware.
     */
    public getProxyTarget(nodeId: number): { apiUrl: string; apiToken: string } | null {
        const node = DatabaseService.getInstance().getNode(nodeId);
        if (!node || node.type !== 'remote' || !node.api_url || !node.api_token) {
            return null;
        }
        return { apiUrl: node.api_url, apiToken: node.api_token };
    }

    /**
     * Test connectivity to a specific node.
     * - Local: pings the Docker daemon directly
     * - Remote: makes a GET to /api/auth/check on the remote Sencho instance
     */
    public async testConnection(nodeId: number): Promise<{ success: boolean; error?: string; info?: any }> {
        const db = DatabaseService.getInstance();
        const node = db.getNode(nodeId);

        if (!node) {
            return { success: false, error: 'Node not found' };
        }

        if (node.type === 'remote') {
            return this.testRemoteConnection(node);
        }

        return this.testLocalConnection(nodeId);
    }

    private async testLocalConnection(nodeId: number): Promise<{ success: boolean; error?: string; info?: any }> {
        const db = DatabaseService.getInstance();
        try {
            const docker = new Docker();
            const info = await docker.info();

            if (!info || !info.OperatingSystem || typeof info.Containers !== 'number') {
                throw new Error('Invalid response from Docker daemon.');
            }

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

    private async testRemoteConnection(node: Node): Promise<{ success: boolean; error?: string; info?: any }> {
        const db = DatabaseService.getInstance();

        if (!node.api_url || !node.api_token) {
            return { success: false, error: 'Remote node is missing an API URL or token. Configure it in Settings → Nodes.' };
        }

        try {
            const response = await axios.get(`${node.api_url}/api/auth/check`, {
                headers: { Authorization: `Bearer ${node.api_token}` },
                timeout: 8000,
            });

            if (response.status === 200) {
                db.updateNodeStatus(node.id, 'online');
                return {
                    success: true,
                    info: {
                        name: node.name,
                        serverVersion: 'Remote Sencho',
                        os: 'Remote',
                        architecture: 'Remote',
                        containers: '—',
                        containersRunning: '—',
                        images: '—',
                        memTotal: 0,
                        cpus: '—',
                    }
                };
            }

            throw new Error(`Unexpected status ${response.status}`);
        } catch (error: any) {
            db.updateNodeStatus(node.id, 'offline');
            const msg = error.response?.status === 401
                ? 'Authentication failed — check the API token.'
                : (error.message || 'Connection failed');
            return { success: false, error: msg };
        }
    }

    /**
     * Evict a cached Docker connection (e.g., after node config change).
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
     * Get the compose directory for a local node.
     */
    public getComposeDir(nodeId: number): string {
        const db = DatabaseService.getInstance();
        const node = db.getNode(nodeId);
        return node?.compose_dir || process.env.COMPOSE_DIR || '/app/compose';
    }
}
