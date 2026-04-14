import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import semver from 'semver';
import DockerController from './DockerController';
import { DatabaseService } from './DatabaseService';
import { NotificationService } from './NotificationService';
import { isValidVersion } from './CapabilityRegistry';
import { fetchLatestSenchoVersion } from '../utils/version-check';
import { isDebugEnabled } from '../utils/debug';

const execAsync = promisify(exec);

const getMetricDetails = (metric: string): { name: string, unit: string } => {
    switch (metric) {
        case 'cpu_percent': return { name: 'CPU usage', unit: '%' };
        case 'memory_percent': return { name: 'Memory usage', unit: '%' };
        case 'memory_mb': return { name: 'Memory allocation', unit: ' MB' };
        case 'net_rx': return { name: 'Inbound network traffic', unit: ' MB' };
        case 'net_tx': return { name: 'Outbound network traffic', unit: ' MB' };
        case 'restart_count': return { name: 'Restart count', unit: ' restarts' };
        default: return { name: metric, unit: '' };
    }
};

const getOperatorPhrase = (operator: string): string => {
    if (['>', '>='].includes(operator)) return 'has exceeded your threshold of';
    if (['<', '<='].includes(operator)) return 'has dropped below your threshold of';
    if (operator === '==') return 'has reached your threshold of';
    return `triggered the operator ${operator}`;
};

/** Shape of the JSON returned by Docker container stats (stream: false). */
interface DockerContainerStats {
    cpu_stats?: {
        cpu_usage?: { total_usage: number; percpu_usage?: number[] };
        system_cpu_usage?: number;
        online_cpus?: number;
    };
    precpu_stats?: {
        cpu_usage?: { total_usage: number };
        system_cpu_usage?: number;
    };
    memory_stats?: {
        usage?: number;
        limit?: number;
        stats?: { cache?: number };
    };
    networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

interface AlertState {
    breachStartedAt: number; // timestamp when the rule first breached
}

const HOST_ALERT_KEYS = {
    cpu: 'last_host_cpu_alert_ts',
    ram: 'last_host_ram_alert_ts',
    disk: 'last_host_disk_alert_ts',
    janitor: 'last_janitor_alert_timestamp',
} as const;

export class MonitorService {
    private static instance: MonitorService;
    private intervalId: NodeJS.Timeout | null = null;
    private isProcessing = false;

    // Track the duration a specific stack alert rule has been in breach state
    // key: rule_id, value: AlertState
    private activeBreaches = new Map<number, AlertState>();

    // Track containers that have already been alerted as crashed to avoid
    // duplicate alerts. key: containerId, value: timestamp when alerted.
    private alertedCrashes = new Map<string, number>();
    private static readonly CRASH_ALERT_TTL_MS = 60 * 60 * 1000; // 1 hour

    // Sencho version check cooldown (6 hours between external API calls)
    private lastVersionCheckAt = 0;
    private static readonly VERSION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

    private constructor() { }

    public static getInstance(): MonitorService {
        if (!MonitorService.instance) {
            MonitorService.instance = new MonitorService();
        }
        return MonitorService.instance;
    }

    public start() {
        if (this.intervalId) return;
        if (isDebugEnabled()) console.log('[Monitor:diag] Starting evaluation loop (30s interval)');

        // Run every 30 seconds
        this.intervalId = setInterval(() => {
            this.evaluate();
        }, 30000);

        // Run an initial evaluation slightly after boot
        setTimeout(() => this.evaluate(), 5000);
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            if (isDebugEnabled()) console.log('[Monitor:diag] Evaluation loop stopped');
        }
    }

    private async evaluate() {
        if (this.isProcessing) return; // Prevent overlap if slow
        this.isProcessing = true;

        try {
            const db = DatabaseService.getInstance();
            const settings = db.getGlobalSettings();

            await this.evaluateGlobalSettings(settings);
            await this.evaluateStackAlerts(db);
        } catch (error) {
            console.error('MonitorService Evaluation Error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    private async evaluateGlobalSettings(settings: Record<string, string>) {
        const notifier = NotificationService.getInstance();
        const HOST_ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between repeat alerts

        // 1. Host Limits
        try {
            const currentLoad = await si.currentLoad();
            const cpuUsage = currentLoad.currentLoad;
            const cpuLimit = parseFloat(settings['host_cpu_limit']);
            if (!isNaN(cpuLimit) && cpuLimit > 0 && cpuUsage > cpuLimit) {
                await this.dispatchWithCooldown(HOST_ALERT_KEYS.cpu, HOST_ALERT_COOLDOWN_MS, 'warning',
                    `Host CPU utilization is critically high: ${cpuUsage.toFixed(1)}% (Threshold: ${cpuLimit}%)`);
            }

            const mem = await si.mem();
            const ramUsage = (mem.used / mem.total) * 100;
            const ramLimit = parseFloat(settings['host_ram_limit']);
            if (!isNaN(ramLimit) && ramLimit > 0 && ramUsage > ramLimit) {
                await this.dispatchWithCooldown(HOST_ALERT_KEYS.ram, HOST_ALERT_COOLDOWN_MS, 'warning',
                    `Host Memory utilization is critically high: ${ramUsage.toFixed(1)}% (Threshold: ${ramLimit}%)`);
            }

            const fsSize = await si.fsSize();
            const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:') || fsSize[0];
            if (mainDisk) {
                const diskLimit = parseFloat(settings['host_disk_limit']);
                if (!isNaN(diskLimit) && diskLimit > 0 && mainDisk.use > diskLimit) {
                    await this.dispatchWithCooldown(HOST_ALERT_KEYS.disk, HOST_ALERT_COOLDOWN_MS, 'warning',
                        `Host Disk space utilization is critically high: ${mainDisk.use.toFixed(1)}% (Threshold: ${diskLimit}%)`);
                }
            }
        } catch (e) {
            console.error('Error checking host limits in watchdog', e);
        }

        // 2. Global Crash Detect
        if (settings['global_crash'] === '1') {
            // Prune expired entries from the crash tracker
            const now = Date.now();
            for (const [id, ts] of this.alertedCrashes) {
                if (now - ts > MonitorService.CRASH_ALERT_TTL_MS) this.alertedCrashes.delete(id);
            }

            try {
                const nodes = DatabaseService.getInstance().getNodes();
                const runningIds = new Set<string>();

                for (const node of nodes) {
                    if (!node.id) continue;
                    // Remote nodes run their own MonitorService locally
                    if (node.type === 'remote') continue;
                    try {
                        const docker = DockerController.getInstance(node.id);
                        const containers = await docker.getAllContainers();
                        for (const c of containers) {
                            if (c.State === 'running') {
                                runningIds.add(c.Id);
                                continue;
                            }
                            // Skip containers already alerted
                            if (this.alertedCrashes.has(c.Id)) continue;

                            const containerStack = c.Labels?.['com.docker.compose.project'] || undefined;

                            if (c.State === 'exited') {
                                const match = c.Status.match(/Exited \((\d+)\)/i);
                                const exitCode = match ? parseInt(match[1], 10) : null;
                                const intentionalExitCodes = [0, 137, 143, 255];
                                if (exitCode !== null && !intentionalExitCodes.includes(exitCode)) {
                                    await notifier.dispatchAlert('error', `[Node: ${node.name}] Container Crash Detected: ${c.Names[0]} exited unexpectedly (Code: ${exitCode}).`, containerStack);
                                    this.alertedCrashes.set(c.Id, now);
                                }
                            } else if (String(c.Status).includes('unhealthy')) {
                                await notifier.dispatchAlert('error', `[Node: ${node.name}] Healthcheck Failed: Container ${c.Names[0]} is unhealthy.`, containerStack);
                                this.alertedCrashes.set(c.Id, now);
                            }
                        }
                    } catch (err) {
                        console.error(`Error checking crashes on node ${node.name}`, err);
                    }
                }

                // Clear crash tracking for containers that are running again
                for (const id of this.alertedCrashes.keys()) {
                    if (runningIds.has(id)) this.alertedCrashes.delete(id);
                }
            } catch (e) {
                console.error('Error checking global crashes', e);
            }
        }

        // 3. Docker Janitor Check
        try {
            const janitorLimitGb = parseFloat(settings['docker_janitor_gb']);
            if (!isNaN(janitorLimitGb) && janitorLimitGb > 0) {
                // Run docker system df to find reclamable space
                const { stdout } = await execAsync('docker system df --format "{{json .}}"');
                // Output might be multiple lines of JSON (Images, Containers, Local Volumes, Build Cache)
                let totalReclaimableBytes = 0;
                const lines = stdout.split('\n').filter(l => l.trim().length > 0);
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        // RECLAIMABLE might be something like "1.2GB" or "400MB" Let's parse it manually or just use raw sizes from docker api. Actually docker system df JSON format gives Reclaimable field as string e.g. "1.196GB" (or "0B").
                        const reclaimStr = parsed.Reclaimable;
                        if (reclaimStr) {
                            // Extract the number and the unit. e.g "1.196GB" (92%) -> 1.196
                            const match = reclaimStr.match(/^([0-9.]+)([a-zA-Z]+)/);
                            if (match) {
                                const val = parseFloat(match[1]);
                                const unit = match[2];
                                let bytes = 0;
                                if (unit === 'GB') bytes = val * 1024 * 1024 * 1024;
                                else if (unit === 'MB') bytes = val * 1024 * 1024;
                                else if (unit === 'KB') bytes = val * 1024;
                                else if (unit === 'B') bytes = val;

                                totalReclaimableBytes += bytes;
                            }
                        }
                    } catch (e) {
                        console.warn('[MonitorService] Failed to parse Docker system df output:', e);
                    }
                }

                const reclaimGb = totalReclaimableBytes / (1024 * 1024 * 1024);
                const JANITOR_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

                if (reclaimGb >= janitorLimitGb) {
                    await this.dispatchWithCooldown(HOST_ALERT_KEYS.janitor, JANITOR_COOLDOWN_MS, 'info',
                        `Your system has accumulated ${reclaimGb.toFixed(1)} GB of unused Docker data. Consider using the Janitor tool.`);
                }
            }
        } catch (e) {
            console.error('Error checking docker janitor limits', e);
        }

        // 4. Sencho version update check (runs once per VERSION_CHECK_INTERVAL_MS)
        if (Date.now() - this.lastVersionCheckAt > MonitorService.VERSION_CHECK_INTERVAL_MS) {
            this.lastVersionCheckAt = Date.now();
            try {
                const currentVersion = process.env.npm_package_version || '0.0.0';
                const latest = await fetchLatestSenchoVersion();
                if (isValidVersion(latest) && isValidVersion(currentVersion) && semver.gt(latest, currentVersion)) {
                    const db = DatabaseService.getInstance();
                    const stateKey = 'last_sencho_update_notified_version';
                    const lastNotified = db.getSystemState(stateKey) || '';
                    if (lastNotified !== latest) {
                        const notifier = NotificationService.getInstance();
                        await notifier.dispatchAlert('info',
                            `Sencho ${latest} is available (currently running ${currentVersion}). Visit the Fleet dashboard to update.`);
                        db.setSystemState(stateKey, latest);
                    }
                }
            } catch (e) {
                // Network errors are expected; do not spam logs
                if (isDebugEnabled()) console.debug('[Monitor:diag] Sencho version check failed:', e);
            }
        }
    }

    private async evaluateStackAlerts(db: DatabaseService) {
        const alerts = db.getStackAlerts();
        const nodes = db.getNodes();

        // Pre-group alerts by stack name to avoid O(containers * alerts) scanning
        const alertsByStack = new Map<string, typeof alerts>();
        for (const a of alerts) {
            const list = alertsByStack.get(a.stack_name);
            if (list) list.push(a);
            else alertsByStack.set(a.stack_name, [a]);
        }

        for (const node of nodes) {
            if (!node.id) continue;
            // Remote nodes are self-monitoring - skip direct Docker access
            if (node.type === 'remote') continue;
            try {
                const docker = DockerController.getInstance(node.id);
                const containers = await docker.getRunningContainers();
                for (const container of containers) {
                    const stackName = container.Labels?.['com.docker.compose.project'] || 'system';

                    try {
                        const rawStats = await docker.getContainerStatsStream(container.Id);
                        const stats: DockerContainerStats = JSON.parse(rawStats);

                        const usedMemory = (stats.memory_stats?.usage || 0) - (stats.memory_stats?.stats?.cache || 0);

                        // Only fetch restart count when at least one rule for this stack uses it
                        const stackAlerts = alertsByStack.get(stackName) || [];
                        const needsRestartCount = stackAlerts.some(a => a.metric === 'restart_count');
                        const restartCount = needsRestartCount
                            ? await docker.getContainerRestartCount(container.Id)
                            : 0;

                        const metrics = {
                            cpu_percent: this.calculateCpuPercent(stats),
                            memory_percent: this.calculateMemoryPercent(stats),
                            memory_mb: Math.max(0, usedMemory) / (1024 * 1024),
                            net_rx: this.calculateNetwork(stats, 'rx'),
                            net_tx: this.calculateNetwork(stats, 'tx'),
                            restart_count: restartCount,
                        };

                        db.addContainerMetric({
                            container_id: container.Id,
                            stack_name: stackName,
                            cpu_percent: metrics.cpu_percent || 0,
                            memory_mb: metrics.memory_mb || 0,
                            net_rx_mb: metrics.net_rx || 0,
                            net_tx_mb: metrics.net_tx || 0,
                            timestamp: Date.now()
                        });

                        for (const rule of stackAlerts) {
                            const ruleId = rule.id!;
                            const currentValue = metrics[rule.metric as keyof typeof metrics];

                            if (currentValue === undefined) continue;

                            const isBreaching = this.evaluateCondition(currentValue, rule.operator, rule.threshold);

                            if (isBreaching) {
                                if (!this.activeBreaches.has(ruleId)) {
                                    this.activeBreaches.set(ruleId, { breachStartedAt: Date.now() });
                                    if (isDebugEnabled()) console.log(`[Monitor:diag] Breach entered: rule ${ruleId} (${rule.metric} ${rule.operator} ${rule.threshold}) on stack "${rule.stack_name}"`);
                                }

                                const breachState = this.activeBreaches.get(ruleId)!;
                                const durationMs = Date.now() - breachState.breachStartedAt;
                                const requiredDurationMs = rule.duration_mins * 60 * 1000;

                                if (durationMs >= requiredDurationMs) {
                                    // Duration met! Check cooldown
                                    const timeSinceLastFired = Date.now() - (rule.last_fired_at || 0);
                                    const requiredCooldownMs = rule.cooldown_mins * 60 * 1000;

                                    if (timeSinceLastFired >= requiredCooldownMs) {
                                        // Formatted Alert Message
                                        const { name: metricName, unit } = getMetricDetails(rule.metric);
                                        const operatorPhrase = getOperatorPhrase(rule.operator);

                                        const safeCurrent = typeof currentValue === 'number' ? Number(currentValue.toFixed(2)) : currentValue;
                                        const safeThreshold = typeof rule.threshold === 'number' ? Number(rule.threshold.toFixed(2)) : rule.threshold;

                                        const message = `[Node: ${node.name}] The **${metricName}** for **${rule.stack_name}** ${operatorPhrase} **${safeThreshold}${unit}** (Currently: ${safeCurrent}${unit}).`;

                                        if (isDebugEnabled()) console.log(`[Monitor:diag] Duration met for rule ${ruleId}, dispatching alert`);
                                        await NotificationService.getInstance().dispatchAlert(
                                            'warning',
                                            message,
                                            rule.stack_name
                                        );

                                        // Update last fired
                                        db.updateStackAlertLastFired(ruleId, Date.now());
                                    } else if (isDebugEnabled()) {
                                        console.log(`[Monitor:diag] Cooldown active for rule ${ruleId}: ${Math.round((requiredCooldownMs - timeSinceLastFired) / 1000)}s remaining`);
                                    }
                                }
                            } else {
                                // Rule isn't breaching anymore, reset tracker
                                if (this.activeBreaches.has(ruleId)) {
                                    if (isDebugEnabled()) console.log(`[Monitor:diag] Breach cleared: rule ${ruleId} on stack "${rule.stack_name}"`);
                                    this.activeBreaches.delete(ruleId);
                                }
                            }
                        }
                    } catch (e) {
                        // Containers can be removed between getRunningContainers() and the
                        // per-container stats call (e.g., during a stack update). Dockerode
                        // throws a 404 in that case. That's expected churn, not a real
                        // error, so skip silently rather than flooding the logs.
                        const err = e as { statusCode?: number; reason?: string };
                        if (err?.statusCode === 404 || err?.reason === 'no such container') {
                            continue;
                        }
                        console.error(`Error parsing stats for container ${container.Id} on node ${node.name}`, e);
                    }
                }
            } catch (err) {
                console.error(`Error fetching containers for node ${node.name}`, err);
            }
        }

        try {
            const settings = db.getGlobalSettings();
            const retentionHours = parseInt(settings['metrics_retention_hours'] || '24', 10);
            db.cleanupOldMetrics(isNaN(retentionHours) ? 24 : retentionHours);
            const retentionDays = parseInt(settings['log_retention_days'] || '30', 10);
            db.cleanupOldNotifications(isNaN(retentionDays) ? 30 : retentionDays);
            const auditRetentionDays = parseInt(settings['audit_retention_days'] || '90', 10);
            db.cleanupOldAuditLogs(isNaN(auditRetentionDays) ? 90 : auditRetentionDays);
            if (isDebugEnabled()) console.log(`[Monitor:diag] Cleanup: metrics ${isNaN(retentionHours) ? 24 : retentionHours}h, notifications ${isNaN(retentionDays) ? 30 : retentionDays}d, audit ${isNaN(auditRetentionDays) ? 90 : auditRetentionDays}d`);
        } catch (e) {
            console.error('MonitorService: failed to cleanup old data', e);
        }
    }

    private evaluateCondition(actual: number, operator: string, threshold: number): boolean {
        switch (operator) {
            case '>': return actual > threshold;
            case '<': return actual < threshold;
            case '>=': return actual >= threshold;
            case '<=': return actual <= threshold;
            case '==': return actual === threshold;
            default: return false;
        }
    }

    /** Dispatch an alert only if the cooldown period has elapsed since the last alert for this key. */
    private async dispatchWithCooldown(
        stateKey: string, cooldownMs: number,
        severity: 'info' | 'warning' | 'error', message: string, stack?: string,
    ): Promise<void> {
        const db = DatabaseService.getInstance();
        const last = parseInt(db.getSystemState(stateKey) || '0', 10);
        if (Date.now() - last > cooldownMs) {
            await NotificationService.getInstance().dispatchAlert(severity, message, stack);
            db.setSystemState(stateKey, Date.now().toString());
        }
    }

    private calculateCpuPercent(stats: DockerContainerStats): number {
        let cpuPercent = 0.0;
        if (!stats?.cpu_stats?.cpu_usage || !stats?.precpu_stats?.cpu_usage) return 0.0;

        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = (stats.cpu_stats.system_cpu_usage || 0) - (stats.precpu_stats.system_cpu_usage || 0);
        const numCpus = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage ? stats.cpu_stats.cpu_usage.percpu_usage.length : 1);

        if (systemDelta > 0.0 && cpuDelta > 0.0) {
            cpuPercent = (cpuDelta / systemDelta) * numCpus * 100.0;
        }
        return cpuPercent;
    }

    private calculateMemoryPercent(stats: DockerContainerStats): number {
        if (!stats?.memory_stats?.usage || !stats?.memory_stats?.limit) return 0.0;

        const used_memory = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
        const available_memory = stats.memory_stats.limit;
        if (available_memory > 0) {
            return (used_memory / available_memory) * 100.0;
        }
        return 0.0;
    }

    private calculateNetwork(stats: DockerContainerStats, direction: 'rx' | 'tx'): number {
        let bytes = 0;
        if (stats.networks) {
            const key = direction === 'rx' ? 'rx_bytes' : 'tx_bytes';
            for (const iface in stats.networks) {
                bytes += stats.networks[iface][key];
            }
        }
        return bytes / (1024 * 1024); // Return in MB
    }
}
