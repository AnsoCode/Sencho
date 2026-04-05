import { CronExpressionParser } from 'cron-parser';
import { DatabaseService } from './DatabaseService';
import type { ScheduledTask } from './DatabaseService';
import { LicenseService } from './LicenseService';
import DockerController from './DockerController';
import { ComposeService } from './ComposeService';
import { FileSystemService } from './FileSystemService';
import { ImageUpdateService } from './ImageUpdateService';
import { NodeRegistry } from './NodeRegistry';
import { NotificationService } from './NotificationService';

export class SchedulerService {
    private static instance: SchedulerService;
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private isProcessing = false;
    private runningTasks = new Set<number>();

    private constructor() {}

    public static getInstance(): SchedulerService {
        if (!SchedulerService.instance) {
            SchedulerService.instance = new SchedulerService();
        }
        return SchedulerService.instance;
    }

    public start(): void {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.tick(), 60_000);
        setTimeout(() => this.tick(), 10_000);
        console.log('[SchedulerService] Started');
    }

    public stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log('[SchedulerService] Stopped');
    }

    public calculateNextRun(cronExpression: string): number {
        const expr = CronExpressionParser.parse(cronExpression);
        return expr.next().toDate().getTime();
    }

    private async tick(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;
        try {
            const ls = LicenseService.getInstance();
            const isPaid = ls.getTier() === 'paid';
            const isAdmiral = isPaid && ls.getVariant() === 'team';
            if (!isPaid) return; // No scheduled tasks for unpaid tiers

            const db = DatabaseService.getInstance();
            const now = Date.now();
            const dueTasks = db.getDueScheduledTasks(now);

            // Clean up old runs periodically (piggyback on tick)
            db.cleanupOldTaskRuns(30);

            for (const task of dueTasks) {
                // Skipper users can only run 'update' tasks; other actions require Admiral
                if (!isAdmiral && task.action !== 'update') continue;
                if (this.runningTasks.has(task.id)) continue;
                this.runningTasks.add(task.id);
                this.executeTask(task).finally(() => this.runningTasks.delete(task.id));
            }
        } catch (error) {
            console.error('[SchedulerService] Tick error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    // Intentionally allows triggering disabled tasks — useful for testing before enabling a schedule.
    // Manual triggers are attributed as 'manual' in the run record (see triggered_by column).
    public async triggerTask(taskId: number): Promise<void> {
        const db = DatabaseService.getInstance();
        const task = db.getScheduledTask(taskId);
        if (!task) throw new Error('Task not found');
        if (this.runningTasks.has(task.id)) throw new Error('Task is already running');
        this.runningTasks.add(task.id);
        try {
            await this.executeTask(task, 'manual');
        } finally {
            this.runningTasks.delete(task.id);
        }
    }

    private async executeTask(task: ScheduledTask, triggeredBy: 'scheduler' | 'manual' = 'scheduler'): Promise<void> {
        const db = DatabaseService.getInstance();
        const runId = db.createScheduledTaskRun({
            task_id: task.id,
            started_at: Date.now(),
            completed_at: null,
            status: 'running',
            output: null,
            error: null,
            triggered_by: triggeredBy,
        });

        try {
            // Pre-check: ensure target node exists and is reachable
            if (task.node_id != null && task.action !== 'snapshot') {
                const node = db.getNode(task.node_id);
                if (!node) throw new Error(`Target node (id=${task.node_id}) no longer exists`);
                if (node.status === 'offline') throw new Error(`Target node "${node.name}" is offline`);
            }

            let output = '';
            switch (task.action) {
                case 'restart':
                    output = await this.executeRestart(task);
                    break;
                case 'snapshot':
                    output = await this.executeSnapshot(task);
                    break;
                case 'prune':
                    output = await this.executePrune(task);
                    break;
                case 'update':
                    output = await this.executeUpdate(task);
                    break;
            }

            const nextRun = this.calculateNextRun(task.cron_expression);
            db.updateScheduledTask(task.id, {
                last_run_at: Date.now(),
                next_run_at: nextRun,
                last_status: 'success',
                last_error: null,
                updated_at: Date.now(),
            });
            db.updateScheduledTaskRun(runId, {
                completed_at: Date.now(),
                status: 'success',
                output,
            });
            console.log(`[SchedulerService] Task "${task.name}" (id=${task.id}) completed successfully`);
            if (task.last_status === 'failure') {
                NotificationService.getInstance().dispatchAlert(
                    'info',
                    `Scheduled task "${task.name}" (${task.action}) recovered successfully`,
                    task.target_id ?? undefined
                );
            }
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            let nextRun: number | null = null;
            try {
                nextRun = this.calculateNextRun(task.cron_expression);
            } catch {
                // If cron expression is somehow invalid, disable the task
            }
            db.updateScheduledTask(task.id, {
                last_run_at: Date.now(),
                next_run_at: nextRun,
                last_status: 'failure',
                last_error: errMsg,
                updated_at: Date.now(),
            });
            db.updateScheduledTaskRun(runId, {
                completed_at: Date.now(),
                status: 'failure',
                error: errMsg,
            });
            console.error(`[SchedulerService] Task "${task.name}" (id=${task.id}) failed:`, errMsg);
            NotificationService.getInstance().dispatchAlert(
                'error',
                `Scheduled task "${task.name}" (${task.action}) failed: ${errMsg}`,
                task.target_id ?? undefined
            );
        }
    }

    private async executeRestart(task: ScheduledTask): Promise<string> {
        if (!task.target_id || task.node_id == null) {
            throw new Error('Stack restart requires target_id and node_id');
        }
        const docker = DockerController.getInstance(task.node_id);
        const containers = await docker.getContainersByStack(task.target_id);
        if (!containers || containers.length === 0) {
            throw new Error(`No containers found for stack "${task.target_id}"`);
        }

        let filtered = containers;
        if (task.target_services) {
            const serviceNames: string[] = JSON.parse(task.target_services);
            filtered = containers.filter(c => c.Service && serviceNames.includes(c.Service));
            if (filtered.length === 0) {
                throw new Error(`No containers found matching services [${serviceNames.join(', ')}] in stack "${task.target_id}"`);
            }
        }

        await Promise.all(filtered.map(c => docker.restartContainer(c.Id)));
        const servicesSuffix = task.target_services
            ? ` (services: ${(JSON.parse(task.target_services) as string[]).join(', ')})`
            : '';
        return `Restarted ${filtered.length} container(s) in stack "${task.target_id}"${servicesSuffix}`;
    }

    private async executeSnapshot(task: ScheduledTask): Promise<string> {
        const db = DatabaseService.getInstance();
        const nodes = db.getNodes();

        const results = await Promise.allSettled(
            nodes.map(async (node) => {
                if (node.type === 'remote') {
                    return this.captureRemoteNodeFiles(node);
                }
                return this.captureLocalNodeFiles(node);
            })
        );

        const capturedNodes: Array<{ nodeId: number; nodeName: string; stacks: Array<{ stackName: string; files: Array<{ filename: string; content: string }> }> }> = [];
        const skippedNodes: Array<{ nodeId: number; nodeName: string; reason: string }> = [];

        results.forEach((result, i) => {
            if (result.status === 'fulfilled') {
                capturedNodes.push(result.value);
            } else {
                skippedNodes.push({
                    nodeId: nodes[i].id,
                    nodeName: nodes[i].name,
                    reason: result.reason instanceof Error ? result.reason.message : 'Unknown error',
                });
            }
        });

        let totalStacks = 0;
        const allFiles: Array<{ nodeId: number; nodeName: string; stackName: string; filename: string; content: string }> = [];

        for (const nodeData of capturedNodes) {
            totalStacks += nodeData.stacks.length;
            for (const stack of nodeData.stacks) {
                for (const file of stack.files) {
                    allFiles.push({
                        nodeId: nodeData.nodeId,
                        nodeName: nodeData.nodeName,
                        stackName: stack.stackName,
                        filename: file.filename,
                        content: file.content,
                    });
                }
            }
        }

        const description = `Scheduled snapshot: ${task.name}`;
        const snapshotId = db.createSnapshot(
            description,
            task.created_by,
            capturedNodes.length,
            totalStacks,
            JSON.stringify(skippedNodes),
        );

        if (allFiles.length > 0) {
            db.insertSnapshotFiles(snapshotId, allFiles);
        }

        return `Fleet snapshot created (id=${snapshotId}, ${capturedNodes.length} node(s), ${totalStacks} stack(s)${skippedNodes.length > 0 ? `, ${skippedNodes.length} skipped` : ''})`;
    }

    private async captureLocalNodeFiles(node: { id: number; name: string }) {
        const fsService = FileSystemService.getInstance(node.id);
        const stackNames = await fsService.getStacks();
        const stacks: Array<{ stackName: string; files: Array<{ filename: string; content: string }> }> = [];

        for (const stackName of stackNames) {
            const files: Array<{ filename: string; content: string }> = [];
            try {
                const composeContent = await fsService.getStackContent(stackName);
                files.push({ filename: 'compose.yaml', content: composeContent });
            } catch {
                continue;
            }
            try {
                const envContent = await fsService.getEnvContent(stackName);
                files.push({ filename: '.env', content: envContent });
            } catch {
                // No .env file
            }
            stacks.push({ stackName, files });
        }

        return { nodeId: node.id, nodeName: node.name, stacks };
    }

    private async captureRemoteNodeFiles(node: { id: number; name: string; api_url?: string; api_token?: string }) {
        if (!node.api_url || !node.api_token) {
            throw new Error('Remote node not configured');
        }

        const baseUrl = node.api_url.replace(/\/$/, '');
        const headers = { Authorization: `Bearer ${node.api_token}` };

        const stacksRes = await fetch(`${baseUrl}/api/stacks`, {
            headers,
            signal: AbortSignal.timeout(15000),
        });
        if (!stacksRes.ok) throw new Error('Failed to fetch stacks from remote node');
        const stackNames = await stacksRes.json() as string[];

        const stacks: Array<{ stackName: string; files: Array<{ filename: string; content: string }> }> = [];

        for (const stackName of stackNames) {
            const files: Array<{ filename: string; content: string }> = [];
            try {
                const composeRes = await fetch(`${baseUrl}/api/stacks/${encodeURIComponent(stackName)}`, {
                    headers,
                    signal: AbortSignal.timeout(15000),
                });
                if (composeRes.ok) {
                    const content = await composeRes.text();
                    files.push({ filename: 'compose.yaml', content });
                }
            } catch {
                continue;
            }
            try {
                const envRes = await fetch(`${baseUrl}/api/stacks/${encodeURIComponent(stackName)}/env`, {
                    headers,
                    signal: AbortSignal.timeout(15000),
                });
                if (envRes.ok) {
                    const content = await envRes.text();
                    files.push({ filename: '.env', content });
                }
            } catch {
                // No .env
            }
            if (files.length > 0) {
                stacks.push({ stackName, files });
            }
        }

        return { nodeId: node.id, nodeName: node.name, stacks };
    }

    private async executePrune(task: ScheduledTask): Promise<string> {
        const nodeId = task.node_id ?? NodeRegistry.getInstance().getDefaultNodeId();
        const docker = DockerController.getInstance(nodeId);
        const allTargets = ['containers', 'images', 'networks', 'volumes'] as const;
        type PruneTarget = typeof allTargets[number];
        const targets: PruneTarget[] = task.prune_targets
            ? (JSON.parse(task.prune_targets) as string[]).filter((t): t is PruneTarget => allTargets.includes(t as PruneTarget))
            : [...allTargets];
        const labelFilter = task.prune_label_filter || undefined;
        const results: string[] = [];

        for (const target of targets) {
            try {
                const result = await docker.pruneSystem(target, labelFilter);
                results.push(`${target}: ${result.reclaimedBytes ?? 0} bytes reclaimed`);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                results.push(`${target}: failed (${msg})`);
            }
        }

        const filterSuffix = labelFilter ? ` (label: ${labelFilter})` : '';
        return `System prune completed${filterSuffix}: ${results.join('; ')}`;
    }

    private async executeUpdate(task: ScheduledTask): Promise<string> {
        if (!task.target_id || task.node_id == null) {
            throw new Error('Auto-update requires target_id (stack name or "*") and node_id');
        }

        // Resolve target stacks: "*" means all stacks on the node
        let stackNames: string[];
        if (task.target_id === '*') {
            stackNames = await FileSystemService.getInstance(task.node_id).getStacks();
            if (stackNames.length === 0) {
                return 'No stacks found on node — skipped.';
            }
        } else {
            stackNames = [task.target_id];
        }

        const docker = DockerController.getInstance(task.node_id);
        const imageUpdateService = ImageUpdateService.getInstance();
        const compose = ComposeService.getInstance(task.node_id);
        const db = DatabaseService.getInstance();
        const results: string[] = [];

        for (const stackName of stackNames) {
            try {
                const output = await this.executeUpdateForStack(stackName, task.node_id ?? 0, docker, imageUpdateService, compose, db);
                results.push(output);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                results.push(`Stack "${stackName}" failed: ${msg}`);
                console.error(`[SchedulerService] Auto-update failed for stack "${stackName}":`, e);
            }
        }

        return results.join('\n');
    }

    private async executeUpdateForStack(
        stackName: string,
        nodeId: number,
        docker: DockerController,
        imageUpdateService: ImageUpdateService,
        compose: ComposeService,
        db: DatabaseService
    ): Promise<string> {
        const containers = await docker.getContainersByStack(stackName);
        if (!containers || containers.length === 0) {
            return `Stack "${stackName}": no containers found — skipped.`;
        }

        const imageRefs = [...new Set(
            containers
                .map((c: { Image?: string }) => c.Image)
                .filter((img): img is string => !!img && !img.startsWith('sha256:'))
        )];

        if (imageRefs.length === 0) {
            return `Stack "${stackName}": no pullable images — skipped.`;
        }

        let hasUpdate = false;
        const updatedImages: string[] = [];

        for (const imageRef of imageRefs) {
            try {
                if (await imageUpdateService.checkImage(docker, imageRef)) {
                    hasUpdate = true;
                    updatedImages.push(imageRef);
                }
            } catch (e) {
                console.warn(`[SchedulerService] Failed to check image ${imageRef}:`, e);
            }
        }

        if (!hasUpdate) {
            return `Stack "${stackName}": all images up to date.`;
        }

        await compose.updateStack(stackName, undefined, true);
        db.clearStackUpdateStatus(nodeId, stackName);

        NotificationService.getInstance().dispatchAlert(
            'info',
            `Auto-update: stack "${stackName}" updated with new images`,
            stackName
        );

        return `Stack "${stackName}": updated (${updatedImages.join(', ')}).`;
    }
}
