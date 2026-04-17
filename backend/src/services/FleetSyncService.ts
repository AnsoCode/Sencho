import axios, { AxiosError } from 'axios';
import { DatabaseService, Node, ScanPolicy } from './DatabaseService';
import { NodeRegistry } from './NodeRegistry';

export type FleetResource = 'scan_policies';

export type FleetRole = 'control' | 'replica';

export const LOCAL_IDENTITY_SENTINEL = 'local';

/**
 * FleetSyncService replicates security configuration from a control Sencho
 * instance to every managed remote node. Security rules live on the control's
 * SQLite database; each write triggers a push of the full table to every
 * remote that has an api_url and api_token configured.
 *
 * Push failures for a specific remote are logged and recorded on the
 * fleet_sync_status table so the UI and future retry logic can see stale
 * nodes.
 */
export class FleetSyncService {
    private static instance: FleetSyncService;

    private constructor() {}

    public static getInstance(): FleetSyncService {
        if (!FleetSyncService.instance) {
            FleetSyncService.instance = new FleetSyncService();
        }
        return FleetSyncService.instance;
    }

    /**
     * Resolve the fleet role for this instance.
     * A node becomes a replica the first time it accepts a fleet sync push.
     */
    public static getRole(): FleetRole {
        return DatabaseService.getInstance().getSystemState('fleet_role') === 'replica' ? 'replica' : 'control';
    }

    /**
     * The identity string used when matching scan policies on this instance.
     * Control nodes use the LOCAL_IDENTITY_SENTINEL. Replicas use the
     * identity they were told during the most recent sync push. If a replica
     * is missing its cached identity (e.g. the sync row has been corrupted),
     * return the empty string; callers treat this as fleet-wide only and log.
     */
    public static getSelfIdentity(): string {
        if (FleetSyncService.getRole() === 'replica') {
            const cached = DatabaseService.getInstance().getSystemState('fleet_self_identity');
            if (!cached) {
                if (!FleetSyncService.warnedMissingIdentity) {
                    console.warn(
                        '[FleetSync] Replica has no cached self-identity. Identity-scoped policies will not apply until the next sync push.',
                    );
                    FleetSyncService.warnedMissingIdentity = true;
                }
                return '';
            }
            return cached;
        }
        return LOCAL_IDENTITY_SENTINEL;
    }

    private static warnedMissingIdentity = false;

    /**
     * Map a policy's node_id to a node_identity string.
     * - NULL node_id → '' (fleet-wide)
     * - Local node → LOCAL_IDENTITY_SENTINEL
     * - Remote node → the node's api_url
     */
    public static resolveIdentityForNodeId(nodeId: number | null | undefined): string {
        if (nodeId == null) return '';
        const node = NodeRegistry.getInstance().getNode(nodeId);
        if (!node) return '';
        if (node.type === 'remote' && node.api_url) return node.api_url;
        return LOCAL_IDENTITY_SENTINEL;
    }

    /**
     * Push the current state of a resource to every remote node.
     * Failures are recorded but do not bubble up to the caller.
     */
    public async pushResource(resource: FleetResource): Promise<void> {
        if (FleetSyncService.getRole() === 'replica') {
            // Replicas never push; they only receive.
            return;
        }
        const db = DatabaseService.getInstance();
        const nodes = db.getNodes().filter((n): n is Node & { id: number } => {
            return n.type === 'remote' && Boolean(n.api_url) && Boolean(n.api_token) && n.id != null;
        });
        if (nodes.length === 0) return;

        const rows = this.loadResource(resource);
        const pushedAt = Date.now();

        await Promise.all(
            nodes.map(async (node) => {
                const baseUrl = (node.api_url ?? '').replace(/\/$/, '');
                try {
                    await axios.post(
                        `${baseUrl}/api/fleet/sync/${resource}`,
                        {
                            rows,
                            pushedAt,
                            targetIdentity: node.api_url,
                        },
                        {
                            headers: { Authorization: `Bearer ${node.api_token}` },
                            timeout: 15_000,
                        },
                    );
                    db.recordFleetSyncSuccess(node.id, resource);
                } catch (err) {
                    const message = this.formatError(err);
                    console.warn(
                        `[FleetSync] Failed to push ${resource} to "${node.name}" (${baseUrl}): ${message}`,
                    );
                    db.recordFleetSyncFailure(node.id, resource, message);
                }
            }),
        );
    }

    /**
     * Fire and forget helper for write handlers. Errors are already logged
     * inside pushResource; this swallows any residual rejection so request
     * handlers can stay synchronous.
     */
    public pushResourceAsync(resource: FleetResource): void {
        this.pushResource(resource).catch((err) => {
            console.error(`[FleetSync] Unexpected error pushing ${resource}:`, err);
        });
    }

    /**
     * Apply a received sync payload on a replica.
     * This promotes the instance to 'replica' mode if not already, caches
     * the target identity it was told, and replaces replicated rows atomically.
     */
    public applyIncomingSync(resource: FleetResource, rows: ScanPolicy[], targetIdentity: string): void {
        const db = DatabaseService.getInstance();
        db.setSystemState('fleet_role', 'replica');
        if (targetIdentity) {
            db.setSystemState('fleet_self_identity', targetIdentity);
        }
        if (resource === 'scan_policies') {
            db.replaceReplicatedScanPolicies(rows);
        }
    }

    private loadResource(resource: FleetResource): unknown[] {
        const db = DatabaseService.getInstance();
        if (resource === 'scan_policies') {
            return db
                .getScanPolicies()
                .filter((p) => p.replicated_from_control === 0)
                .map((p) => ({
                    name: p.name,
                    node_identity: p.node_identity,
                    stack_pattern: p.stack_pattern,
                    max_severity: p.max_severity,
                    block_on_deploy: p.block_on_deploy,
                    enabled: p.enabled,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                }));
        }
        return [];
    }

    private formatError(err: unknown): string {
        if (err instanceof AxiosError) {
            if (err.response) {
                const data = err.response.data;
                const detail = typeof data === 'object' && data && 'error' in data
                    ? String((data as { error: unknown }).error)
                    : err.response.statusText;
                return `HTTP ${err.response.status}: ${detail}`;
            }
            return err.message;
        }
        return err instanceof Error ? err.message : String(err);
    }
}
