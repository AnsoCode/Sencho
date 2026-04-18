import { DatabaseService, Node } from './DatabaseService';
import { NodeRegistry } from './NodeRegistry';
import { DockerEventService } from './DockerEventService';
import { isDebugEnabled } from '../utils/debug';

/**
 * DockerEventManager
 *
 * Singleton coordinator that owns one DockerEventService per local node.
 * Spawns services on boot for every existing local node, and reacts to
 * NodeRegistry 'node-added' / 'node-removed' / 'node-updated' events to
 * keep the service map in sync with the database.
 *
 * Remote nodes self-monitor on their own Sencho instance; this manager does
 * not subscribe to remote Docker daemons.
 */
export class DockerEventManager {
    private static instance: DockerEventManager;
    private services: Map<number, DockerEventService> = new Map();
    private started = false;

    private readonly onNodeAdded = (id: number) => { void this.handleNodeAdded(id); };
    private readonly onNodeRemoved = (id: number) => { this.handleNodeRemoved(id); };
    private readonly onNodeUpdated = (id: number) => { void this.handleNodeUpdated(id); };

    private constructor() { /* private: use getInstance */ }

    public static getInstance(): DockerEventManager {
        if (!DockerEventManager.instance) {
            DockerEventManager.instance = new DockerEventManager();
        }
        return DockerEventManager.instance;
    }

    /** Boot: spawn a DockerEventService for every existing local node. */
    public async start(): Promise<void> {
        if (this.started) return;
        this.started = true;

        const registry = NodeRegistry.getInstance();
        registry.on('node-added', this.onNodeAdded);
        registry.on('node-removed', this.onNodeRemoved);
        registry.on('node-updated', this.onNodeUpdated);

        // Spawn in parallel so one slow node can't block boot for the others.
        const nodes = DatabaseService.getInstance().getNodes()
            .filter(n => n.type === 'local' && typeof n.id === 'number');
        await Promise.all(nodes.map(n => this.spawn(n)));

        console.log(`[DockerEvents] Started; watching ${this.services.size} local node(s) for container lifecycle events`);
    }

    /** Shutdown: stop every service and unsubscribe from registry events. */
    public stop(): void {
        if (!this.started) return;
        this.started = false;

        const registry = NodeRegistry.getInstance();
        registry.off('node-added', this.onNodeAdded);
        registry.off('node-removed', this.onNodeRemoved);
        registry.off('node-updated', this.onNodeUpdated);

        for (const service of this.services.values()) service.shutdown();
        this.services.clear();

        console.log('[DockerEvents] Stopped');
    }

    /** Aggregated status for diagnostics (e.g. /api/health). */
    public getStatus(): Array<ReturnType<DockerEventService['getStatus']>> {
        return Array.from(this.services.values()).map(s => s.getStatus());
    }

    /** Returns the DockerEventService for a given local node, or undefined if not tracked. */
    public getService(nodeId: number): DockerEventService | undefined {
        return this.services.get(nodeId);
    }

    // ========================================================================
    // Node lifecycle handlers
    // ========================================================================

    private async handleNodeAdded(nodeId: number): Promise<void> {
        if (this.services.has(nodeId)) return;
        const node = DatabaseService.getInstance().getNode(nodeId);
        if (!node || node.type !== 'local') return;
        await this.spawn(node);
    }

    private handleNodeRemoved(nodeId: number): void {
        const service = this.services.get(nodeId);
        if (!service) return;
        service.shutdown();
        this.services.delete(nodeId);
    }

    private async handleNodeUpdated(nodeId: number): Promise<void> {
        const node = DatabaseService.getInstance().getNode(nodeId);
        const existing = this.services.get(nodeId);

        // Node became remote (or was deleted): tear down.
        if (!node || node.type !== 'local') {
            if (existing) {
                existing.shutdown();
                this.services.delete(nodeId);
            }
            return;
        }

        // Node is local: ensure a service exists (respawn if missing).
        if (!existing) {
            await this.spawn(node);
        }
    }

    // ========================================================================
    // Service spawning
    // ========================================================================

    private async spawn(node: Node): Promise<void> {
        if (typeof node.id !== 'number') return;
        if (this.services.has(node.id)) return;

        const service = new DockerEventService(node.id, node.name);
        this.services.set(node.id, service);

        try {
            await service.start();
        } catch (err) {
            if (isDebugEnabled()) {
                console.log(`[DockerEvents:diag] failed to start service for node ${node.name}:`,
                    err instanceof Error ? err.message : err);
            }
        }
    }
}
