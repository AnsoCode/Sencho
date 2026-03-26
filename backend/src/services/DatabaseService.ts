import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface Agent {
    id?: number;
    type: 'discord' | 'slack' | 'webhook';
    url: string;
    enabled: boolean;
}

export interface GlobalSetting {
    key: string;
    value: string;
}

export interface StackAlert {
    id?: number;
    stack_name: string;
    metric: string;
    operator: string;
    threshold: number;
    duration_mins: number;
    cooldown_mins: number;
    last_fired_at?: number;
}

export interface Node {
    id: number;
    name: string;
    type: 'local' | 'remote';
    compose_dir: string;
    is_default: boolean;
    status: 'online' | 'offline' | 'unknown';
    created_at: number;
    api_url?: string;
    api_token?: string;
}

export interface Webhook {
    id?: number;
    name: string;
    stack_name: string;
    action: 'deploy' | 'restart' | 'stop' | 'start' | 'pull';
    secret: string;
    enabled: boolean;
    created_at: number;
    updated_at: number;
}

export interface WebhookExecution {
    id?: number;
    webhook_id: number;
    action: string;
    status: 'success' | 'failure';
    trigger_source: string | null;
    duration_ms: number | null;
    error: string | null;
    executed_at: number;
}

export interface User {
    id: number;
    username: string;
    password_hash: string;
    role: 'admin' | 'viewer';
    created_at: number;
    updated_at: number;
}

export interface NotificationHistory {
    id?: number;
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: number;
    is_read: boolean;
}

export interface FleetSnapshot {
    id: number;
    description: string;
    created_by: string;
    node_count: number;
    stack_count: number;
    skipped_nodes: string;
    created_at: number;
}

export interface FleetSnapshotFile {
    id: number;
    snapshot_id: number;
    node_id: number;
    node_name: string;
    stack_name: string;
    filename: string;
    content: string;
}

export class DatabaseService {
    private static instance: DatabaseService;
    private db: Database.Database;

    private constructor() {
        const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const dbPath = path.join(dataDir, 'sencho.db');
        this.db = new Database(dbPath);

        this.initSchema();
        this.migrateJsonConfig(dataDir);
        this.migrateAdminToUsersTable();
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public getDb(): Database.Database {
        return this.db;
    }

    private initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        enabled INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stack_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stack_name TEXT NOT NULL,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold REAL NOT NULL,
        duration_mins INTEGER NOT NULL,
        cooldown_mins INTEGER NOT NULL,
        last_fired_at INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS notification_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        is_read INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS container_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT NOT NULL,
        stack_name TEXT NOT NULL,
        cpu_percent REAL NOT NULL,
        memory_mb REAL NOT NULL,
        net_rx_mb REAL NOT NULL,
        net_tx_mb REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON container_metrics(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_container ON container_metrics(container_id);

      CREATE TABLE IF NOT EXISTS stack_update_status (
        stack_name TEXT PRIMARY KEY,
        has_update INTEGER DEFAULT 0,
        checked_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'local',
        compose_dir TEXT NOT NULL DEFAULT '/app/compose',
        is_default INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unknown',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        stack_name TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'deploy',
        secret TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_source TEXT,
        duration_ms INTEGER,
        error TEXT,
        executed_at INTEGER NOT NULL,
        FOREIGN KEY(webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_executions_webhook ON webhook_executions(webhook_id);

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fleet_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        node_count INTEGER NOT NULL,
        stack_count INTEGER NOT NULL,
        skipped_nodes TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fleet_snapshot_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL,
        node_id INTEGER NOT NULL,
        node_name TEXT NOT NULL,
        stack_name TEXT NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY(snapshot_id) REFERENCES fleet_snapshots(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_snapshot_files_snapshot ON fleet_snapshot_files(snapshot_id);
    `);

        // Apply migrations safely (ignore if columns already exist)
        const maybeAddCol = (table: string, col: string, def: string) => {
            try { this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run(); } catch (e) { /* ignore */ }
        };

        // Distributed API model columns
        maybeAddCol('nodes', 'api_url', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'api_token', "TEXT DEFAULT ''");

        // Legacy SSH/TLS columns preserved for DB backward-compat (no longer read or written)
        maybeAddCol('nodes', 'host', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'port', 'INTEGER DEFAULT 2375');
        maybeAddCol('nodes', 'ssh_port', 'INTEGER DEFAULT 22');
        maybeAddCol('nodes', 'ssh_user', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'ssh_password', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'ssh_key', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'tls_ca', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'tls_cert', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'tls_key', "TEXT DEFAULT ''");

        // Initialize default global settings if they don't exist
        const stmt = this.db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
        stmt.run('host_cpu_limit', '90');
        stmt.run('host_ram_limit', '90');
        stmt.run('host_disk_limit', '90');
        stmt.run('global_crash', '1');
        stmt.run('docker_janitor_gb', '5');
        stmt.run('global_logs_refresh', '5');
        stmt.run('developer_mode', '0');
        stmt.run('metrics_retention_hours', '24');
        stmt.run('log_retention_days', '30');

        // Seed the default local node if none exists
        const nodeCount = (this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as any)?.count || 0;
        if (nodeCount === 0) {
            this.db.prepare(
                'INSERT INTO nodes (name, type, compose_dir, is_default, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run('Local', 'local', process.env.COMPOSE_DIR || '/app/compose', 1, 'online', Date.now());
        }
    }

    private migrateAdminToUsersTable(): void {
        const userCount = (this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number })?.count || 0;
        if (userCount > 0) return;

        const settings = this.getGlobalSettings();
        const username = settings.auth_username;
        const passwordHash = settings.auth_password_hash;
        if (!username || !passwordHash) return;

        const now = Date.now();
        this.db.prepare(
            'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(username, passwordHash, 'admin', now, now);
        console.log(`Migrated admin user "${username}" to users table.`);
    }

    private migrateJsonConfig(dataDir: string) {
        const configPath = path.join(dataDir, 'sencho.json');
        if (fs.existsSync(configPath)) {
            try {
                const data = fs.readFileSync(configPath, 'utf-8');
                const config = JSON.parse(data);

                if (config.username && config.passwordHash && config.jwtSecret) {
                    const stmt = this.db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
                    stmt.run('auth_username', config.username);
                    stmt.run('auth_password_hash', config.passwordHash);
                    stmt.run('auth_jwt_secret', config.jwtSecret);

                    console.log('Successfully migrated sencho.json credentials to SQLite global_settings.');
                    fs.unlinkSync(configPath);
                }
            } catch (err) {
                console.error('Failed to migrate sencho.json:', err);
            }
        }
    }

    // --- Agents ---

    public getAgents(): Agent[] {
        const stmt = this.db.prepare('SELECT * FROM agents');
        return stmt.all().map((row: any) => ({
            ...row,
            enabled: row.enabled === 1
        }));
    }

    public getEnabledAgents(): Agent[] {
        const stmt = this.db.prepare('SELECT * FROM agents WHERE enabled = 1');
        return stmt.all().map((row: any) => ({
            ...row,
            enabled: row.enabled === 1
        }));
    }

    public upsertAgent(agent: Agent): void {
        const existing = this.db.prepare('SELECT id FROM agents WHERE type = ?').get(agent.type) as any;
        if (existing) {
            const stmt = this.db.prepare('UPDATE agents SET url = ?, enabled = ? WHERE type = ?');
            stmt.run(agent.url, agent.enabled ? 1 : 0, agent.type);
        } else {
            const stmt = this.db.prepare('INSERT INTO agents (type, url, enabled) VALUES (?, ?, ?)');
            stmt.run(agent.type, agent.url, agent.enabled ? 1 : 0);
        }
    }

    // --- Global Settings ---

    public getGlobalSettings(): Record<string, string> {
        const stmt = this.db.prepare('SELECT * FROM global_settings');
        const settings: Record<string, string> = {};
        stmt.all().forEach((row: any) => {
            settings[row.key] = row.value;
        });
        return settings;
    }

    public updateGlobalSetting(key: string, value: string): void {
        const stmt = this.db.prepare('INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)');
        stmt.run(key, value);
    }

    // --- System State (operational/runtime values - not user-defined config) ---

    public getSystemState(key: string): string | null {
        const row = this.db.prepare('SELECT value FROM system_state WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    public setSystemState(key: string, value: string): void {
        this.db.prepare('INSERT OR REPLACE INTO system_state (key, value) VALUES (?, ?)').run(key, value);
    }

    // --- Stack Alerts ---

    public getStackAlerts(stackName?: string): StackAlert[] {
        let stmt;
        if (stackName) {
            stmt = this.db.prepare('SELECT * FROM stack_alerts WHERE stack_name = ?');
            return stmt.all(stackName) as StackAlert[];
        } else {
            stmt = this.db.prepare('SELECT * FROM stack_alerts');
            return stmt.all() as StackAlert[];
        }
    }

    public addStackAlert(alert: StackAlert): void {
        const stmt = this.db.prepare(
            'INSERT INTO stack_alerts (stack_name, metric, operator, threshold, duration_mins, cooldown_mins, last_fired_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run(
            alert.stack_name,
            alert.metric,
            alert.operator,
            alert.threshold,
            alert.duration_mins,
            alert.cooldown_mins,
            alert.last_fired_at || 0
        );
    }

    public deleteStackAlert(id: number): void {
        const stmt = this.db.prepare('DELETE FROM stack_alerts WHERE id = ?');
        stmt.run(id);
    }

    public updateStackAlertLastFired(id: number, timestamp: number): void {
        const stmt = this.db.prepare('UPDATE stack_alerts SET last_fired_at = ? WHERE id = ?');
        stmt.run(timestamp, id);
    }

    // --- Notification History ---

    public getNotificationHistory(limit = 50): NotificationHistory[] {
        const stmt = this.db.prepare('SELECT * FROM notification_history ORDER BY timestamp DESC LIMIT ?');
        return stmt.all(limit).map((row: any) => ({
            ...row,
            is_read: row.is_read === 1
        }));
    }

    public addNotificationHistory(notification: Omit<NotificationHistory, 'id' | 'is_read'>): NotificationHistory {
        const stmt = this.db.prepare('INSERT INTO notification_history (level, message, timestamp, is_read) VALUES (?, ?, ?, 0)');
        const result = stmt.run(notification.level, notification.message, notification.timestamp);

        this.db.exec(`
      DELETE FROM notification_history
      WHERE id NOT IN (
        SELECT id FROM notification_history ORDER BY timestamp DESC LIMIT 100
      )
    `);

        return {
            id: result.lastInsertRowid as number,
            level: notification.level,
            message: notification.message,
            timestamp: notification.timestamp,
            is_read: false,
        };
    }

    public markAllNotificationsRead(): void {
        const stmt = this.db.prepare('UPDATE notification_history SET is_read = 1');
        stmt.run();
    }

    public deleteNotification(id: number): void {
        const stmt = this.db.prepare('DELETE FROM notification_history WHERE id = ?');
        stmt.run(id);
    }

    public deleteAllNotifications(): void {
        const stmt = this.db.prepare('DELETE FROM notification_history');
        stmt.run();
    }

    // --- Container Metrics ---

    public addContainerMetric(metric: Omit<any, 'id'>): void {
        const stmt = this.db.prepare(
            'INSERT INTO container_metrics (container_id, stack_name, cpu_percent, memory_mb, net_rx_mb, net_tx_mb, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run(metric.container_id, metric.stack_name, metric.cpu_percent, metric.memory_mb, metric.net_rx_mb, metric.net_tx_mb, metric.timestamp);
    }

    public getContainerMetrics(hoursLookback = 24): any[] {
        const cutoff = Date.now() - (hoursLookback * 60 * 60 * 1000);
        const stmt = this.db.prepare(`
            SELECT
              container_id,
              stack_name,
              AVG(cpu_percent) as cpu_percent,
              AVG(memory_mb) as memory_mb,
              MAX(net_rx_mb) as net_rx_mb,
              MAX(net_tx_mb) as net_tx_mb,
              (timestamp / 60000) * 60000 as timestamp
            FROM container_metrics
            WHERE timestamp >= ?
            GROUP BY container_id, stack_name, (timestamp / 60000)
            ORDER BY timestamp ASC
        `);
        return stmt.all(cutoff);
    }

    public cleanupOldMetrics(hoursToKeep = 24): void {
        const cutoff = Date.now() - (hoursToKeep * 60 * 60 * 1000);
        const stmt = this.db.prepare('DELETE FROM container_metrics WHERE timestamp < ?');
        stmt.run(cutoff);
    }

    public cleanupOldNotifications(daysToKeep = 30): void {
        const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        this.db.prepare('DELETE FROM notification_history WHERE timestamp < ?').run(cutoff);
    }

    // --- Nodes ---

    public getNodes(): Node[] {
        const stmt = this.db.prepare('SELECT id, name, type, compose_dir, is_default, status, created_at, api_url, api_token FROM nodes ORDER BY is_default DESC, name ASC');
        return stmt.all().map((row: any) => ({
            ...row,
            is_default: row.is_default === 1
        }));
    }

    public getNode(id: number): Node | undefined {
        const stmt = this.db.prepare('SELECT id, name, type, compose_dir, is_default, status, created_at, api_url, api_token FROM nodes WHERE id = ?');
        const row = stmt.get(id) as any;
        if (!row) return undefined;
        return { ...row, is_default: row.is_default === 1 };
    }

    public getDefaultNode(): Node | undefined {
        const stmt = this.db.prepare('SELECT id, name, type, compose_dir, is_default, status, created_at, api_url, api_token FROM nodes WHERE is_default = 1 LIMIT 1');
        const row = stmt.get() as any;
        if (!row) return undefined;
        return { ...row, is_default: row.is_default === 1 };
    }

    public addNode(node: Omit<Node, 'id' | 'status' | 'created_at'>): number {
        if (node.is_default) {
            this.db.prepare('UPDATE nodes SET is_default = 0').run();
        }
        const stmt = this.db.prepare(
            'INSERT INTO nodes (name, type, compose_dir, is_default, status, created_at, api_url, api_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const result = stmt.run(
            node.name,
            node.type,
            node.compose_dir || '/app/compose',
            node.is_default ? 1 : 0,
            'unknown',
            Date.now(),
            node.api_url || '',
            node.api_token || ''
        );
        return result.lastInsertRowid as number;
    }

    public updateNode(id: number, updates: Partial<Omit<Node, 'id' | 'created_at'>>): void {
        const node = this.getNode(id);
        if (!node) throw new Error(`Node with id ${id} not found`);

        if (updates.is_default) {
            this.db.prepare('UPDATE nodes SET is_default = 0').run();
        }

        const fields: string[] = [];
        const values: any[] = [];

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
        if (updates.compose_dir !== undefined) { fields.push('compose_dir = ?'); values.push(updates.compose_dir); }
        if (updates.is_default !== undefined) { fields.push('is_default = ?'); values.push(updates.is_default ? 1 : 0); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.api_url !== undefined) { fields.push('api_url = ?'); values.push(updates.api_url); }
        if (updates.api_token !== undefined) { fields.push('api_token = ?'); values.push(updates.api_token); }

        if (fields.length === 0) return;

        values.push(id);
        this.db.prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteNode(id: number): void {
        const node = this.getNode(id);
        if (node?.is_default) {
            throw new Error('Cannot delete the default node');
        }
        this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    }

    public updateNodeStatus(id: number, status: 'online' | 'offline' | 'unknown'): void {
        this.db.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(status, id);
    }

    // --- Stack Update Status ---

    public upsertStackUpdateStatus(stackName: string, hasUpdate: boolean, checkedAt: number): void {
        this.db.prepare(
            'INSERT OR REPLACE INTO stack_update_status (stack_name, has_update, checked_at) VALUES (?, ?, ?)'
        ).run(stackName, hasUpdate ? 1 : 0, checkedAt);
    }

    public getStackUpdateStatus(): Record<string, boolean> {
        const rows = this.db.prepare('SELECT stack_name, has_update FROM stack_update_status').all() as any[];
        const result: Record<string, boolean> = {};
        for (const row of rows) {
            result[row.stack_name] = row.has_update === 1;
        }
        return result;
    }

    // --- Webhooks ---

    public getWebhooks(): Webhook[] {
        return this.db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all().map((row: any) => ({
            ...row,
            enabled: row.enabled === 1,
        }));
    }

    public getWebhook(id: number): Webhook | undefined {
        const row = this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any;
        if (!row) return undefined;
        return { ...row, enabled: row.enabled === 1 };
    }

    public addWebhook(webhook: Omit<Webhook, 'id' | 'created_at' | 'updated_at'>): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO webhooks (name, stack_name, action, secret, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(webhook.name, webhook.stack_name, webhook.action, webhook.secret, webhook.enabled ? 1 : 0, now, now);
        return result.lastInsertRowid as number;
    }

    public updateWebhook(id: number, updates: Partial<Pick<Webhook, 'name' | 'stack_name' | 'action' | 'enabled'>>): void {
        const fields: string[] = [];
        const values: (string | number)[] = [];

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.stack_name !== undefined) { fields.push('stack_name = ?'); values.push(updates.stack_name); }
        if (updates.action !== undefined) { fields.push('action = ?'); values.push(updates.action); }
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }

        if (fields.length === 0) return;

        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);
        this.db.prepare(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteWebhook(id: number): void {
        this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    }

    // --- Webhook Executions ---

    public getWebhookExecutions(webhookId: number, limit = 20): WebhookExecution[] {
        return this.db.prepare(
            'SELECT * FROM webhook_executions WHERE webhook_id = ? ORDER BY executed_at DESC LIMIT ?'
        ).all(webhookId, limit) as WebhookExecution[];
    }

    public addWebhookExecution(execution: Omit<WebhookExecution, 'id'>): number {
        const result = this.db.prepare(
            'INSERT INTO webhook_executions (webhook_id, action, status, trigger_source, duration_ms, error, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(execution.webhook_id, execution.action, execution.status, execution.trigger_source, execution.duration_ms, execution.error, execution.executed_at);

        // Keep only last 100 executions per webhook
        this.db.prepare(
            'DELETE FROM webhook_executions WHERE webhook_id = ? AND id NOT IN (SELECT id FROM webhook_executions WHERE webhook_id = ? ORDER BY executed_at DESC LIMIT 100)'
        ).run(execution.webhook_id, execution.webhook_id);

        return result.lastInsertRowid as number;
    }

    // --- Users ---

    public getUsers(): Omit<User, 'password_hash'>[] {
        return this.db.prepare('SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at ASC').all() as Omit<User, 'password_hash'>[];
    }

    public getUser(id: number): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    }

    public getUserByUsername(username: string): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
    }

    public addUser(user: { username: string; password_hash: string; role: 'admin' | 'viewer' }): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(user.username, user.password_hash, user.role, now, now);
        return result.lastInsertRowid as number;
    }

    public updateUser(id: number, updates: Partial<{ username: string; password_hash: string; role: string }>): void {
        const fields: string[] = [];
        const values: (string | number)[] = [];

        if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username); }
        if (updates.password_hash !== undefined) { fields.push('password_hash = ?'); values.push(updates.password_hash); }
        if (updates.role !== undefined) { fields.push('role = ?'); values.push(updates.role); }

        if (fields.length === 0) return;

        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);
        this.db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteUser(id: number): void {
        this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }

    public getUserCount(): number {
        return (this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number })?.count || 0;
    }

    public getAdminCount(): number {
        return (this.db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number })?.count || 0;
    }

    public getViewerCount(): number {
        return (this.db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'viewer'").get() as { count: number })?.count || 0;
    }

    // --- Fleet Snapshots ---

    public createSnapshot(description: string, createdBy: string, nodeCount: number, stackCount: number, skippedNodes: string): number {
        const result = this.db.prepare(
            'INSERT INTO fleet_snapshots (description, created_by, node_count, stack_count, skipped_nodes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(description, createdBy, nodeCount, stackCount, skippedNodes, Date.now());
        return result.lastInsertRowid as number;
    }

    public insertSnapshotFiles(snapshotId: number, files: Array<{ nodeId: number; nodeName: string; stackName: string; filename: string; content: string }>): void {
        const insert = this.db.prepare(
            'INSERT INTO fleet_snapshot_files (snapshot_id, node_id, node_name, stack_name, filename, content) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertMany = this.db.transaction((rows: Array<{ nodeId: number; nodeName: string; stackName: string; filename: string; content: string }>) => {
            for (const row of rows) {
                insert.run(snapshotId, row.nodeId, row.nodeName, row.stackName, row.filename, row.content);
            }
        });
        insertMany(files);
    }

    public getSnapshots(limit = 50, offset = 0): FleetSnapshot[] {
        return this.db.prepare(
            'SELECT * FROM fleet_snapshots ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as FleetSnapshot[];
    }

    public getSnapshot(id: number): FleetSnapshot | undefined {
        return this.db.prepare('SELECT * FROM fleet_snapshots WHERE id = ?').get(id) as FleetSnapshot | undefined;
    }

    public getSnapshotFiles(snapshotId: number): FleetSnapshotFile[] {
        return this.db.prepare(
            'SELECT * FROM fleet_snapshot_files WHERE snapshot_id = ? ORDER BY node_name, stack_name'
        ).all(snapshotId) as FleetSnapshotFile[];
    }

    public getSnapshotStackFiles(snapshotId: number, nodeId: number, stackName: string): FleetSnapshotFile[] {
        return this.db.prepare(
            'SELECT * FROM fleet_snapshot_files WHERE snapshot_id = ? AND node_id = ? AND stack_name = ?'
        ).all(snapshotId, nodeId, stackName) as FleetSnapshotFile[];
    }

    public deleteSnapshot(id: number): void {
        this.db.prepare('DELETE FROM fleet_snapshots WHERE id = ?').run(id);
    }

    public getSnapshotCount(): number {
        return (this.db.prepare('SELECT COUNT(*) as count FROM fleet_snapshots').get() as { count: number })?.count || 0;
    }
}
