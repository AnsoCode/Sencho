import { INTENTIONAL_KILL_WINDOW_MS } from './ContainerLifecycleClassifier';
import { DatabaseService, AutoHealPolicy, AutoHealHistoryEntry } from './DatabaseService';
import DockerController from './DockerController';
import { DockerEventManager } from './DockerEventManager';
import { ContainerHealthSnapshot } from './DockerEventService';
import { NotificationService } from './NotificationService';

// Dockerode listContainers shape (subset used here)
type ContainerInfo = {
    Id: string;
    Names?: string[];
    Labels?: Record<string, string>;
};

const EVAL_INTERVAL_MS = 30_000;
const INITIAL_DELAY_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60 * 60_000; // 1 hour

export class AutoHealService {
    private static instance: AutoHealService;
    private intervalId: NodeJS.Timeout | null = null;
    private initialTimer: NodeJS.Timeout | null = null;
    private isProcessing = false;
    private restartTimestamps = new Map<string, number[]>();

    private constructor() {}

    static getInstance(): AutoHealService {
        if (!AutoHealService.instance) {
            AutoHealService.instance = new AutoHealService();
        }
        return AutoHealService.instance;
    }

    start(): void {
        this.initialTimer = setTimeout(() => {
            void this.evaluate();
            this.intervalId = setInterval(() => void this.evaluate(), EVAL_INTERVAL_MS);
        }, INITIAL_DELAY_MS);
    }

    stop(): void {
        if (this.initialTimer) {
            clearTimeout(this.initialTimer);
            this.initialTimer = null;
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async evaluate(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;
        try {
            const db = DatabaseService.getInstance();
            const policies = db.getAutoHealPolicies().filter(p => p.enabled === 1);
            if (policies.length === 0) return;

            // Evaluate only on local nodes (remote nodes self-monitor via their own instance)
            const nodes = db.getNodes().filter(n => n.type === 'local');
            for (const node of nodes) {
                await this.evaluateForNode(node.id, policies);
            }
        } catch (err) {
            console.error('[AutoHeal] evaluate error:', err instanceof Error ? err.message : err);
        } finally {
            this.isProcessing = false;
        }
    }

    private async evaluateForNode(nodeId: number, policies: AutoHealPolicy[]): Promise<void> {
        let containers: ContainerInfo[];
        try {
            containers = await DockerController.getInstance(nodeId).getRunningContainers();
        } catch (err) {
            console.error(
                `[AutoHeal] failed to list containers on node ${nodeId}:`,
                err instanceof Error ? err.message : err,
            );
            return;
        }

        const db = DatabaseService.getInstance();
        const eventSvc = DockerEventManager.getInstance().getService(nodeId);
        const now = Date.now();

        // Prune stale entries for containers no longer running on this node
        const liveIds = new Set(containers.map(c => c.Id));
        for (const [cid, timestamps] of this.restartTimestamps.entries()) {
            const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
            if (recent.length === 0 || !liveIds.has(cid)) {
                this.restartTimestamps.delete(cid);
            } else {
                this.restartTimestamps.set(cid, recent);
            }
        }

        for (const policy of policies) {
            if (policy.id === undefined) {
                console.warn('[AutoHeal] skipping policy without id:', policy.stack_name);
                continue;
            }
            const candidates = containers.filter(c => {
                const labels = c.Labels ?? {};
                if (labels['com.docker.compose.project'] !== policy.stack_name) return false;
                if (policy.service_name) {
                    return labels['com.docker.compose.service'] === policy.service_name;
                }
                return true;
            });

            for (const container of candidates) {
                const containerName =
                    container.Names?.[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12);
                const serviceOverride = container.Labels?.['com.docker.compose.service'] ?? null;
                const state = eventSvc?.getContainerState(container.Id);
                const decision = this.shouldHeal(state, policy, container.Id, now);

                if (!decision.heal) {
                    if (
                        decision.skipReason &&
                        decision.skipReason !== 'not_unhealthy' &&
                        decision.skipReason !== 'duration_not_met'
                    ) {
                        db.recordAutoHealHistory({
                            policy_id: policy.id!,
                            stack_name: policy.stack_name,
                            service_name: policy.service_name ?? serviceOverride,
                            container_name: containerName,
                            container_id: container.Id,
                            action: decision.skipReason as AutoHealHistoryEntry['action'],
                            reason: this.skipReasonText(decision.skipReason),
                            success: 0,
                            error: null,
                            timestamp: now,
                        });
                    }
                    continue;
                }

                await this.executeHeal(
                    policy,
                    nodeId,
                    container.Id,
                    containerName,
                    policy.service_name ?? serviceOverride,
                );
            }
        }
    }

    private shouldHeal(
        state: ContainerHealthSnapshot | undefined,
        policy: AutoHealPolicy,
        containerId: string,
        now: number,
    ): { heal: boolean; skipReason?: string } {
        // No state tracked yet, or container is not unhealthy
        if (!state || state.healthStatus !== 'unhealthy' || !state.unhealthySince) {
            return { heal: false, skipReason: 'not_unhealthy' };
        }

        // Duration threshold not yet met
        const unhealthyMs = now - state.unhealthySince;
        if (unhealthyMs < policy.unhealthy_duration_mins * 60_000) {
            return { heal: false, skipReason: 'duration_not_met' };
        }

        // Suppress if user recently killed the container
        if (state.lastKillAt !== undefined && now - state.lastKillAt < INTENTIONAL_KILL_WINDOW_MS) {
            return { heal: false, skipReason: 'skipped_user_action' };
        }

        // Cooldown: respect last_fired_at
        if (policy.last_fired_at > 0 && now - policy.last_fired_at < policy.cooldown_mins * 60_000) {
            return { heal: false, skipReason: 'skipped_cooldown' };
        }

        // Rate limit: max restarts per hour
        const recentRestarts = (this.restartTimestamps.get(containerId) ?? []).filter(
            t => now - t < RATE_LIMIT_WINDOW_MS,
        );
        if (recentRestarts.length >= policy.max_restarts_per_hour) {
            return { heal: false, skipReason: 'skipped_rate_limit' };
        }

        return { heal: true };
    }

    private async executeHeal(
        policy: AutoHealPolicy,
        nodeId: number,
        containerId: string,
        containerName: string,
        serviceName: string | null,
    ): Promise<void> {
        const db = DatabaseService.getInstance();
        const now = Date.now();
        const baseEntry = {
            policy_id: policy.id!,
            stack_name: policy.stack_name,
            service_name: serviceName,
            container_name: containerName,
            container_id: containerId,
            timestamp: now,
        };

        try {
            await DockerController.getInstance(nodeId).restartContainer(containerId);

            db.resetConsecutiveFailures(policy.id!);
            db.updateAutoHealPolicy(policy.id!, { last_fired_at: now });

            const timestamps = this.restartTimestamps.get(containerId) ?? [];
            timestamps.push(now);
            this.restartTimestamps.set(
                containerId,
                timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS),
            );

            db.recordAutoHealHistory({
                ...baseEntry,
                action: 'restarted',
                reason: `Container unhealthy for ${policy.unhealthy_duration_mins} minute(s); auto-restarted.`,
                success: 1,
                error: null,
            });

            db.insertAuditLog({
                timestamp: now,
                username: 'system',
                method: 'POST',
                path: '/api/auto-heal/execute',
                status_code: 200,
                node_id: nodeId,
                ip_address: '127.0.0.1',
                summary: `Auto-healed container ${containerName} on stack ${policy.stack_name}`,
            });

            NotificationService.getInstance()
                .dispatchAlert(
                    'info',
                    `Auto-Heal: Restarted ${containerName} on stack ${policy.stack_name} after being unhealthy for ${policy.unhealthy_duration_mins} minute(s).`,
                    policy.stack_name,
                )
                .catch(err => console.error('[AutoHeal] notification dispatch failed:', err));
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);

            db.incrementConsecutiveFailures(policy.id!);
            // Re-read to get updated consecutive_failures count
            const updated = db.getAutoHealPolicy(policy.id!);
            const failures = updated?.consecutive_failures ?? policy.consecutive_failures + 1;

            db.recordAutoHealHistory({
                ...baseEntry,
                action: 'failed',
                reason: `Restart failed: ${errorMsg}`,
                success: 0,
                error: errorMsg,
            });

            NotificationService.getInstance()
                .dispatchAlert(
                    'warning',
                    `Auto-Heal: Failed to restart ${containerName} on stack ${policy.stack_name}. Error: ${errorMsg}`,
                    policy.stack_name,
                )
                .catch(e => console.error('[AutoHeal] notification dispatch failed:', e));

            // Auto-disable if failure threshold reached
            if (failures >= policy.auto_disable_after_failures) {
                this.handleAutoDisable(policy.id!, policy, baseEntry, failures);
            }

            console.error(`[AutoHeal] restart failed for ${containerName} (${containerId}):`, errorMsg);
        }
    }

    private handleAutoDisable(
        policyId: number,
        policy: AutoHealPolicy,
        baseEntry: Omit<Parameters<DatabaseService['recordAutoHealHistory']>[0], 'action' | 'reason' | 'success' | 'error'>,
        failures: number,
    ): void {
        const db = DatabaseService.getInstance();
        db.setPolicyEnabled(policyId, false);
        db.recordAutoHealHistory({
            ...baseEntry,
            action: 'policy_auto_disabled',
            reason: `Policy disabled after ${failures} consecutive restart failures. Check container logs and re-enable when resolved.`,
            success: 0,
            error: null,
        });
        NotificationService.getInstance()
            .dispatchAlert(
                'warning',
                `Auto-Heal: Policy for ${policy.stack_name}${policy.service_name ? '/' + policy.service_name : ''} has been auto-disabled after ${failures} consecutive failures.`,
                policy.stack_name,
            )
            .catch(e => console.error('[AutoHeal] notification dispatch failed:', e));
    }

    private skipReasonText(reason: string): string {
        switch (reason) {
            case 'skipped_user_action':
                return 'Skipped: recent user action detected on this container.';
            case 'skipped_cooldown':
                return 'Skipped: cooldown period has not elapsed since last restart.';
            case 'skipped_rate_limit':
                return 'Skipped: hourly restart limit reached for this container.';
            default:
                return reason;
        }
    }
}
