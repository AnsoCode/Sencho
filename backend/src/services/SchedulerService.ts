import { CronExpressionParser } from 'cron-parser';
import { DatabaseService } from './DatabaseService';
import type { ScheduledTask } from './DatabaseService';
import { LicenseService } from './LicenseService';
import DockerController from './DockerController';
import { FileSystemService } from './FileSystemService';
import { NodeRegistry } from './NodeRegistry';

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
            if (ls.getTier() !== 'pro' || ls.getVariant() !== 'team') return;

            const db = DatabaseService.getInstance();
            const now = Date.now();
            const dueTasks = db.getDueScheduledTasks(now);

            // Clean up old runs periodically (piggyback on tick)
            db.cleanupOldTaskRuns(30);

            for (const task of dueTasks) {
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
        await Promise.all(containers.map(c => docker.restartContainer(c.Id)));
        return `Restarted ${containers.length} container(s) in stack "${task.target_id}"`;
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
        const results: string[] = [];

        for (const target of targets) {
            try {
                const result = await docker.pruneSystem(target);
                results.push(`${target}: ${result.reclaimedBytes ?? 0} bytes reclaimed`);
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                results.push(`${target}: failed (${msg})`);
            }
        }

        return `System prune completed: ${results.join('; ')}`;
    }
}
