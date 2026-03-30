import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import DockerController from './DockerController';
import { DatabaseService } from './DatabaseService';
import { NotificationService } from './NotificationService';

const execAsync = promisify(exec);

const getMetricDetails = (metric: string): { name: string, unit: string } => {
    switch (metric) {
        case 'cpu_percent': return { name: 'CPU usage', unit: '%' };
        case 'memory_percent': return { name: 'Memory usage', unit: '%' };
        case 'memory_mb': return { name: 'Memory allocation', unit: ' MB' };
        case 'net_rx': return { name: 'Inbound network traffic', unit: ' MB/s' };
        case 'net_tx': return { name: 'Outbound network traffic', unit: ' MB/s' };
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

interface AlertState {
    breachStartedAt: number; // timestamp when the rule first breached
}

export class MonitorService {
    private static instance: MonitorService;
    private intervalId: NodeJS.Timeout | null = null;
    private isProcessing = false;

    // Track the duration a specific stack alert rule has been in breach state
    // key: rule_id, value: AlertState
    private activeBreaches = new Map<number, AlertState>();

    private constructor() { }

    public static getInstance(): MonitorService {
        if (!MonitorService.instance) {
            MonitorService.instance = new MonitorService();
        }
        return MonitorService.instance;
    }

    public start() {
        if (this.intervalId) return;

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

        // 1. Host Limits
        try {
            const currentLoad = await si.currentLoad();
            const cpuUsage = currentLoad.currentLoad;
            const cpuLimit = parseFloat(settings['host_cpu_limit']);
            if (!isNaN(cpuLimit) && cpuLimit > 0 && cpuUsage > cpuLimit) {
                await notifier.dispatchAlert('warning', `Host CPU utilization is critically high: ${cpuUsage.toFixed(1)}% (Threshold: ${cpuLimit}%)`);
            }

            const mem = await si.mem();
            const ramUsage = (mem.used / mem.total) * 100;
            const ramLimit = parseFloat(settings['host_ram_limit']);
            if (!isNaN(ramLimit) && ramLimit > 0 && ramUsage > ramLimit) {
                await notifier.dispatchAlert('warning', `Host Memory utilization is critically high: ${ramUsage.toFixed(1)}% (Threshold: ${ramLimit}%)`);
            }

            const fsSize = await si.fsSize();
            const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:') || fsSize[0];
            if (mainDisk) {
                const diskLimit = parseFloat(settings['host_disk_limit']);
                if (!isNaN(diskLimit) && diskLimit > 0 && mainDisk.use > diskLimit) {
                    await notifier.dispatchAlert('warning', `Host Disk space utilization is critically high: ${mainDisk.use.toFixed(1)}% (Threshold: ${diskLimit}%)`);
                }
            }
        } catch (e) {
            console.error('Error checking host limits in watchdog', e);
        }

        // 2. Global Crash Detect
        if (settings['global_crash'] === '1') {
            try {
                const nodes = DatabaseService.getInstance().getNodes();
                for (const node of nodes) {
                    if (!node.id) continue;
                    // Remote nodes run their own MonitorService locally - skip direct Docker access
                    if (node.type === 'remote') continue;
                    try {
                        const docker = DockerController.getInstance(node.id);
                        const containers = await docker.getAllContainers();
                        for (const c of containers) {
                            if (c.State === 'exited' || String(c.Status).includes('unhealthy')) {
                                if (c.State === 'exited') {
                                    if (c.Status.includes('seconds ago')) {
                                        const match = c.Status.match(/Exited \((\d+)\)/i);
                                        const exitCode = match ? parseInt(match[1], 10) : null;
                                        const intentionalExitCodes = [0, 137, 143, 255];
                                        if (exitCode !== null && !intentionalExitCodes.includes(exitCode)) {
                                            await notifier.dispatchAlert('error', `[Node: ${node.name}] Container Crash Detected: ${c.Names[0]} exited unexpectedly (Code: ${exitCode}).`);
                                        }
                                    }
                                } else if (String(c.Status).includes('unhealthy')) {
                                    await notifier.dispatchAlert('error', `[Node: ${node.name}] Healthcheck Failed: Container ${c.Names[0]} is unhealthy.`);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Error checking crashes on node ${node.name}`, err);
                    }
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
                    } catch (e) { }
                }

                const reclaimGb = totalReclaimableBytes / (1024 * 1024 * 1024);
                // Only trigger once every while? To avoid spamming, we just check if it's over limit
                // Let's ensure we only spam once per limit breach. We can use a local static variable.
                const LAST_JANITOR_ALERT_KEY = 'last_janitor_alert_timestamp';
                const lastAlertRaw = DatabaseService.getInstance().getSystemState(LAST_JANITOR_ALERT_KEY);
                const lastAlert = parseInt(lastAlertRaw || '0', 10);
                const janitorCooldown = 24 * 60 * 60 * 1000; // 24 hours cooldown for janitor

                if (reclaimGb >= janitorLimitGb) {
                    if (Date.now() - lastAlert > janitorCooldown) {
                        await notifier.dispatchAlert('info', `Your system has accumulated ${reclaimGb.toFixed(1)} GB of unused Docker data. Consider using the Janitor tool.`);
                        DatabaseService.getInstance().setSystemState(LAST_JANITOR_ALERT_KEY, Date.now().toString());
                    }
                }
            }
        } catch (e) {
            console.error('Error checking docker janitor limits', e);
        }
    }

    private async evaluateStackAlerts(db: DatabaseService) {
        const alerts = db.getStackAlerts();
        const nodes = db.getNodes();

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
                        const stats = JSON.parse(rawStats);

                        const metrics = {
                            cpu_percent: this.calculateCpuPercent(stats),
                            memory_percent: this.calculateMemoryPercent(stats),
                            memory_mb: (stats.memory_stats?.usage || 0) / (1024 * 1024),
                            net_rx: this.calculateNetwork(stats, 'rx'),
                            net_tx: this.calculateNetwork(stats, 'tx'),
                            restart_count: 0 // Simplification since ContainerInfo doesn't have it natively
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

                        const stackAlerts = alerts.filter(a => a.stack_name === stackName);
                        for (const rule of stackAlerts) {
                            const ruleId = rule.id!;
                            const currentValue = metrics[rule.metric as keyof typeof metrics];

                            if (currentValue === undefined) continue;

                            const isBreaching = this.evaluateCondition(currentValue, rule.operator, rule.threshold);

                            if (isBreaching) {
                                if (!this.activeBreaches.has(ruleId)) {
                                    this.activeBreaches.set(ruleId, { breachStartedAt: Date.now() });
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

                                        await NotificationService.getInstance().dispatchAlert(
                                            'warning',
                                            message
                                        );

                                        // Update last fired
                                        db.updateStackAlertLastFired(ruleId, Date.now());
                                    }
                                }
                            } else {
                                // Rule isn't breaching anymore, reset tracker
                                if (this.activeBreaches.has(ruleId)) {
                                    this.activeBreaches.delete(ruleId);
                                }
                            }
                        }
                    } catch (e) {
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

    private calculateCpuPercent(stats: any): number {
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

    private calculateMemoryPercent(stats: any): number {
        if (!stats?.memory_stats?.usage || !stats?.memory_stats?.limit) return 0.0;

        const used_memory = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
        const available_memory = stats.memory_stats.limit;
        if (available_memory > 0) {
            return (used_memory / available_memory) * 100.0;
        }
        return 0.0;
    }

    private calculateNetwork(stats: any, direction: 'rx' | 'tx'): number {
        let bytes = 0;
        if (stats.networks) {
            for (const iface in stats.networks) {
                bytes += stats.networks[iface][`${direction}_bytes`];
            }
        }
        return bytes / (1024 * 1024); // Return in MB
    }
}
