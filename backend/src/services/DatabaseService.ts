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

export interface NotificationHistory {
    id?: number;
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: number;
    is_read: boolean;
}

export class DatabaseService {
    private static instance: DatabaseService;
    private db: Database.Database;

    private constructor() {
        const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');

        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const dbPath = path.join(dataDir, 'sencho.db');
        this.db = new Database(dbPath);
        // Default journal mode is safer for arbitrary Docker volume mounts than WAL

        this.initSchema();
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
    `);

        // Initialize default global settings if they don't exist
        const stmt = this.db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
        stmt.run('host_cpu_limit', '90');
        stmt.run('host_ram_limit', '90');
        stmt.run('host_disk_limit', '90');
        stmt.run('global_crash', '1');
        stmt.run('docker_janitor_gb', '5');
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

    public addNotificationHistory(notification: Omit<NotificationHistory, 'id' | 'is_read'>): void {
        const stmt = this.db.prepare('INSERT INTO notification_history (level, message, timestamp, is_read) VALUES (?, ?, ?, 0)');
        stmt.run(notification.level, notification.message, notification.timestamp);

        // Cleanup old notifications (keep last 100)
        this.db.exec(`
      DELETE FROM notification_history 
      WHERE id NOT IN (
        SELECT id FROM notification_history ORDER BY timestamp DESC LIMIT 100
      )
    `);
    }

    public markAllNotificationsRead(): void {
        const stmt = this.db.prepare('UPDATE notification_history SET is_read = 1');
        stmt.run();
    }
}
