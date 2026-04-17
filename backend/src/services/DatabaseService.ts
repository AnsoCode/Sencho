import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { CryptoService } from './CryptoService';

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

export interface Label {
    id: number;
    node_id: number;
    name: string;
    color: string;
}

export type WebhookAction = 'deploy' | 'restart' | 'stop' | 'start' | 'pull' | 'git-pull';

export interface Webhook {
    id?: number;
    name: string;
    stack_name: string;
    action: WebhookAction;
    secret: string;
    enabled: boolean;
    created_at: number;
    updated_at: number;
}

export type GitSourceAuthType = 'none' | 'token';

export interface StackGitSource {
    id?: number;
    stack_name: string;
    repo_url: string;
    branch: string;
    compose_path: string;
    sync_env: boolean;
    env_path: string | null;
    auth_type: GitSourceAuthType;
    encrypted_token: string | null;
    auto_apply_on_webhook: boolean;
    auto_deploy_on_apply: boolean;
    last_applied_commit_sha: string | null;
    last_applied_content_hash: string | null;
    pending_commit_sha: string | null;
    pending_compose_content: string | null;
    pending_env_content: string | null;
    pending_fetched_at: number | null;
    last_debounce_at: number | null;
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

export type AuthProvider = 'local' | 'ldap' | 'oidc_google' | 'oidc_github' | 'oidc_okta' | 'oidc_custom';

export type UserRole = 'admin' | 'viewer' | 'deployer' | 'node-admin' | 'auditor';
export type ResourceType = 'stack' | 'node';

export interface User {
    id: number;
    username: string;
    password_hash: string;
    role: UserRole;
    auth_provider: AuthProvider;
    provider_id: string | null;
    email: string | null;
    token_version: number;
    created_at: number;
    updated_at: number;
}

export interface UserMfa {
    user_id: number;
    enabled: number;
    totp_secret_encrypted: string | null;
    backup_codes_json: string | null;
    sso_enforce_mfa: number;
    failed_attempts: number;
    locked_until: number | null;
    created_at: number;
    updated_at: number;
}

export type UserMfaUpdate = Partial<{
    enabled: boolean;
    totp_secret_encrypted: string | null;
    backup_codes_json: string | null;
    sso_enforce_mfa: boolean;
    failed_attempts: number;
    locked_until: number | null;
}>;

export interface RoleAssignment {
    id: number;
    user_id: number;
    role: UserRole;
    resource_type: ResourceType;
    resource_id: string;
    created_at: number;
}

export interface SSOConfig {
    id: number;
    provider: string;
    enabled: number;
    config_json: string;
    created_at: number;
    updated_at: number;
}

export interface NotificationHistory {
    id?: number;
    level: 'info' | 'warning' | 'error';
    message: string;
    timestamp: number;
    is_read: boolean;
    dispatch_error?: string;
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

export interface AuditLogEntry {
    id: number;
    timestamp: number;
    username: string;
    method: string;
    path: string;
    status_code: number;
    node_id: number | null;
    ip_address: string;
    summary: string;
}

export type ApiTokenScope = 'read-only' | 'deploy-only' | 'full-admin';

export interface ApiToken {
    id: number;
    token_hash: string;
    name: string;
    scope: ApiTokenScope;
    user_id: number;
    created_at: number;
    last_used_at: number | null;
    expires_at: number | null;
    revoked_at: number | null;
}

export interface ScheduledTask {
    id: number;
    name: string;
    target_type: 'stack' | 'fleet' | 'system';
    target_id: string | null;
    node_id: number | null;
    action: 'restart' | 'snapshot' | 'prune' | 'update' | 'scan';
    cron_expression: string;
    enabled: number;
    created_by: string;
    created_at: number;
    updated_at: number;
    last_run_at: number | null;
    next_run_at: number | null;
    last_status: string | null;
    last_error: string | null;
    prune_targets: string | null;
    target_services: string | null;
    prune_label_filter: string | null;
}

export interface ScheduledTaskRun {
    id: number;
    task_id: number;
    started_at: number;
    completed_at: number | null;
    status: 'running' | 'success' | 'failure';
    output: string | null;
    error: string | null;
    triggered_by: 'scheduler' | 'manual';
}

export type RegistryType = 'dockerhub' | 'ghcr' | 'ecr' | 'custom';

export interface Registry {
    id: number;
    name: string;
    url: string;
    type: RegistryType;
    username: string;
    secret: string;
    aws_region: string | null;
    created_at: number;
    updated_at: number;
}

export interface NotificationRoute {
    id: number;
    name: string;
    stack_patterns: string[];
    channel_type: 'discord' | 'slack' | 'webhook';
    channel_url: string;
    priority: number;
    enabled: boolean;
    created_at: number;
    updated_at: number;
}

export type VulnSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type VulnScanStatus = 'in_progress' | 'completed' | 'failed';
export type VulnScanTrigger = 'manual' | 'scheduled' | 'deploy';

export interface VulnerabilityScan {
    id: number;
    node_id: number;
    image_ref: string;
    image_digest: string | null;
    scanned_at: number;
    total_vulnerabilities: number;
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    unknown_count: number;
    fixable_count: number;
    highest_severity: VulnSeverity | null;
    os_info: string | null;
    trivy_version: string | null;
    scan_duration_ms: number | null;
    triggered_by: VulnScanTrigger;
    status: VulnScanStatus;
    error: string | null;
    stack_context: string | null;
}

export interface VulnerabilityDetail {
    id: number;
    scan_id: number;
    vulnerability_id: string;
    pkg_name: string;
    installed_version: string;
    fixed_version: string | null;
    severity: VulnSeverity;
    title: string | null;
    description: string | null;
    primary_url: string | null;
}

export interface ScanPolicy {
    id: number;
    name: string;
    node_id: number | null;
    stack_pattern: string | null;
    max_severity: VulnSeverity;
    block_on_deploy: number;
    enabled: number;
    created_at: number;
    updated_at: number;
}

export interface ScanSummary {
    image_ref: string;
    highest_severity: VulnSeverity | null;
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    fixable: number;
    scanned_at: number;
    scan_id: number;
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
        this.migrateEncryptNodeTokens();
        this.migrateSSOColumns();
        this.migrateRegistries();
        this.migrateRoleAssignments();
        this.migrateNotificationRoutes();
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
        node_id INTEGER NOT NULL DEFAULT 0,
        stack_name TEXT NOT NULL,
        has_update INTEGER DEFAULT 0,
        checked_at INTEGER NOT NULL,
        PRIMARY KEY (node_id, stack_name)
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

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        username TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER NOT NULL DEFAULT 0,
        node_id INTEGER,
        ip_address TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username);

      CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'read-only',
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        expires_at INTEGER,
        revoked_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        node_id INTEGER,
        action TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER,
        last_status TEXT,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS scheduled_task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        output TEXT,
        error TEXT,
        FOREIGN KEY(task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task ON scheduled_task_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_status ON scheduled_task_runs(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);

      CREATE TABLE IF NOT EXISTS vulnerability_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL,
        image_ref TEXT NOT NULL,
        image_digest TEXT,
        scanned_at INTEGER NOT NULL,
        total_vulnerabilities INTEGER NOT NULL DEFAULT 0,
        critical_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        medium_count INTEGER NOT NULL DEFAULT 0,
        low_count INTEGER NOT NULL DEFAULT 0,
        unknown_count INTEGER NOT NULL DEFAULT 0,
        fixable_count INTEGER NOT NULL DEFAULT 0,
        highest_severity TEXT,
        os_info TEXT,
        trivy_version TEXT,
        scan_duration_ms INTEGER,
        triggered_by TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'completed',
        error TEXT,
        stack_context TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_vuln_scans_node_image ON vulnerability_scans(node_id, image_ref);
      CREATE INDEX IF NOT EXISTS idx_vuln_scans_digest ON vulnerability_scans(image_digest);
      CREATE INDEX IF NOT EXISTS idx_vuln_scans_scanned_at ON vulnerability_scans(scanned_at);
      CREATE INDEX IF NOT EXISTS idx_vuln_scans_status ON vulnerability_scans(status);

      CREATE TABLE IF NOT EXISTS vulnerability_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NOT NULL,
        vulnerability_id TEXT NOT NULL,
        pkg_name TEXT NOT NULL,
        installed_version TEXT NOT NULL,
        fixed_version TEXT,
        severity TEXT NOT NULL,
        title TEXT,
        description TEXT,
        primary_url TEXT,
        FOREIGN KEY(scan_id) REFERENCES vulnerability_scans(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_vuln_details_scan ON vulnerability_details(scan_id);
      CREATE INDEX IF NOT EXISTS idx_vuln_details_severity ON vulnerability_details(severity);

      CREATE TABLE IF NOT EXISTS scan_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        node_id INTEGER,
        stack_pattern TEXT,
        max_severity TEXT NOT NULL DEFAULT 'CRITICAL',
        block_on_deploy INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stack_labels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        UNIQUE(node_id, name)
      );

      CREATE TABLE IF NOT EXISTS stack_label_assignments (
        label_id INTEGER NOT NULL REFERENCES stack_labels(id) ON DELETE CASCADE,
        stack_name TEXT NOT NULL,
        node_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (label_id, stack_name, node_id)
      );

      CREATE INDEX IF NOT EXISTS idx_label_assignments_stack
        ON stack_label_assignments(stack_name, node_id);

      CREATE TABLE IF NOT EXISTS user_mfa (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0,
        totp_secret_encrypted TEXT,
        backup_codes_json TEXT,
        sso_enforce_mfa INTEGER NOT NULL DEFAULT 0,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mfa_used_tokens (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        window INTEGER NOT NULL,
        used_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, code, window)
      );

      CREATE INDEX IF NOT EXISTS idx_mfa_used_tokens_used_at ON mfa_used_tokens(used_at);

      CREATE TABLE IF NOT EXISTS stack_git_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stack_name TEXT NOT NULL UNIQUE,
        repo_url TEXT NOT NULL,
        branch TEXT NOT NULL,
        compose_path TEXT NOT NULL,
        sync_env INTEGER NOT NULL DEFAULT 0,
        env_path TEXT,
        auth_type TEXT NOT NULL DEFAULT 'none',
        encrypted_token TEXT,
        auto_apply_on_webhook INTEGER NOT NULL DEFAULT 0,
        auto_deploy_on_apply INTEGER NOT NULL DEFAULT 0,
        last_applied_commit_sha TEXT,
        last_applied_content_hash TEXT,
        pending_commit_sha TEXT,
        pending_compose_content TEXT,
        pending_env_content TEXT,
        pending_fetched_at INTEGER,
        last_debounce_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

        // Apply migrations safely (ignore if columns already exist)
        const maybeAddCol = (table: string, col: string, def: string) => {
            try { this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run(); } catch (e) { /* ignore */ }
        };

        // Distributed API model columns
        maybeAddCol('nodes', 'api_url', "TEXT DEFAULT ''");
        maybeAddCol('nodes', 'api_token', "TEXT DEFAULT ''");

        // Scheduled operations migrations
        maybeAddCol('scheduled_task_runs', 'triggered_by', "TEXT NOT NULL DEFAULT 'scheduler'");
        maybeAddCol('scheduled_tasks', 'prune_targets', 'TEXT DEFAULT NULL');
        maybeAddCol('scheduled_tasks', 'target_services', 'TEXT DEFAULT NULL');
        maybeAddCol('scheduled_tasks', 'prune_label_filter', 'TEXT DEFAULT NULL');

        // Recreate stack_update_status with composite PK (node_id, stack_name).
        // Original table had stack_name as sole PK which breaks when multiple nodes share stack names.
        const susInfo = this.db.pragma('table_info(stack_update_status)') as Array<{ name: string; pk: number }>;
        const needsRecreate = susInfo.some(c => c.name === 'stack_name' && c.pk === 1) && !susInfo.some(c => c.name === 'node_id' && c.pk > 0);
        if (needsRecreate) {
          this.db.exec(`
            CREATE TABLE stack_update_status_new (
              node_id INTEGER NOT NULL DEFAULT 0,
              stack_name TEXT NOT NULL,
              has_update INTEGER DEFAULT 0,
              checked_at INTEGER NOT NULL,
              PRIMARY KEY (node_id, stack_name)
            );
            INSERT OR IGNORE INTO stack_update_status_new (node_id, stack_name, has_update, checked_at)
              SELECT COALESCE(node_id, 0), stack_name, has_update, checked_at FROM stack_update_status;
            DROP TABLE stack_update_status;
            ALTER TABLE stack_update_status_new RENAME TO stack_update_status;
          `);
        }

        // Drop legacy SSH/TLS columns from pre-0.7 databases (no longer read or written)
        const legacyCols = ['host', 'port', 'ssh_port', 'ssh_user', 'ssh_password', 'ssh_key', 'tls_ca', 'tls_cert', 'tls_key'];
        for (const col of legacyCols) {
            try { this.db.prepare(`ALTER TABLE nodes DROP COLUMN ${col}`).run(); } catch (e: unknown) {
                // Expected: column already dropped or never existed
                if (!String((e as Error)?.message).includes('no such column')) {
                    console.warn(`[DatabaseService] Unexpected error dropping legacy column "${col}":`, (e as Error).message);
                }
            }
        }

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
        console.log('Migrated legacy admin user to users table.');
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

    private migrateEncryptNodeTokens(): void {
        const crypto = CryptoService.getInstance();
        const rows = this.db.prepare("SELECT id, api_token FROM nodes WHERE api_token != '' AND api_token IS NOT NULL").all() as Array<{ id: number; api_token: string }>;
        for (const row of rows) {
            if (!crypto.isEncrypted(row.api_token)) {
                const encrypted = crypto.encrypt(row.api_token);
                this.db.prepare('UPDATE nodes SET api_token = ? WHERE id = ?').run(encrypted, row.id);
            }
        }
    }

    private migrateSSOColumns(): void {
        const maybeAddCol = (table: string, col: string, def: string) => {
            try { this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run(); } catch (e: unknown) {
                // Expected: column already exists
                if (!String((e as Error)?.message).includes('duplicate column')) {
                    console.warn(`[DatabaseService] Unexpected error adding column "${col}" to "${table}":`, (e as Error).message);
                }
            }
        };
        maybeAddCol('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'local'");
        maybeAddCol('users', 'provider_id', 'TEXT DEFAULT NULL');
        maybeAddCol('users', 'email', 'TEXT DEFAULT NULL');
        maybeAddCol('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sso_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL UNIQUE,
                enabled INTEGER DEFAULT 0,
                config_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, provider_id) WHERE provider_id IS NOT NULL;
        `);
    }

    private migrateRegistries(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS registries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'custom',
                username TEXT NOT NULL DEFAULT '',
                secret TEXT NOT NULL DEFAULT '',
                aws_region TEXT DEFAULT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
    }

    private migrateRoleAssignments(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS role_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_role_assignments_user ON role_assignments(user_id);
            CREATE INDEX IF NOT EXISTS idx_role_assignments_resource ON role_assignments(resource_type, resource_id);
        `);
        try {
            this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_role_assignments_unique ON role_assignments(user_id, role, resource_type, resource_id)');
        } catch (e) {
            console.warn('[DatabaseService] Could not create role_assignments unique index:', (e as Error).message);
        }
    }

    private migrateNotificationRoutes(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS notification_routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                stack_patterns TEXT NOT NULL,
                channel_type TEXT NOT NULL,
                channel_url TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notification_routes_priority ON notification_routes(priority);
        `);
        // Track external dispatch errors on notification records
        try { this.db.prepare('ALTER TABLE notification_history ADD COLUMN dispatch_error TEXT').run(); } catch { /* already exists */ }
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

    // --- Notification Routes ---

    private parseNotificationRoute(row: Record<string, unknown>): NotificationRoute {
        return {
            id: row.id as number,
            name: row.name as string,
            stack_patterns: JSON.parse(row.stack_patterns as string) as string[],
            channel_type: row.channel_type as 'discord' | 'slack' | 'webhook',
            channel_url: row.channel_url as string,
            priority: row.priority as number,
            enabled: row.enabled === 1,
            created_at: row.created_at as number,
            updated_at: row.updated_at as number,
        };
    }

    public getNotificationRoutes(): NotificationRoute[] {
        return this.db.prepare('SELECT * FROM notification_routes ORDER BY priority ASC')
            .all()
            .map((row) => this.parseNotificationRoute(row as Record<string, unknown>));
    }

    public getEnabledNotificationRoutes(): NotificationRoute[] {
        return this.db.prepare('SELECT * FROM notification_routes WHERE enabled = 1 ORDER BY priority ASC')
            .all()
            .map((row) => this.parseNotificationRoute(row as Record<string, unknown>));
    }

    public getNotificationRoute(id: number): NotificationRoute | undefined {
        const row = this.db.prepare('SELECT * FROM notification_routes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
        return row ? this.parseNotificationRoute(row) : undefined;
    }

    public createNotificationRoute(route: Omit<NotificationRoute, 'id'>): NotificationRoute {
        const result = this.db.prepare(
            'INSERT INTO notification_routes (name, stack_patterns, channel_type, channel_url, priority, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
            route.name,
            JSON.stringify(route.stack_patterns),
            route.channel_type,
            route.channel_url,
            route.priority,
            route.enabled ? 1 : 0,
            route.created_at,
            route.updated_at
        );
        return this.getNotificationRoute(result.lastInsertRowid as number)!;
    }

    public updateNotificationRoute(id: number, updates: Partial<Omit<NotificationRoute, 'id' | 'created_at'>>): void {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.stack_patterns !== undefined) { fields.push('stack_patterns = ?'); values.push(JSON.stringify(updates.stack_patterns)); }
        if (updates.channel_type !== undefined) { fields.push('channel_type = ?'); values.push(updates.channel_type); }
        if (updates.channel_url !== undefined) { fields.push('channel_url = ?'); values.push(updates.channel_url); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
        if (updates.updated_at !== undefined) { fields.push('updated_at = ?'); values.push(updates.updated_at); }

        if (fields.length === 0) return;
        values.push(id);
        this.db.prepare(`UPDATE notification_routes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteNotificationRoute(id: number): number {
        return this.db.prepare('DELETE FROM notification_routes WHERE id = ?').run(id).changes;
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

    public addStackAlert(alert: StackAlert): StackAlert {
        const stmt = this.db.prepare(
            'INSERT INTO stack_alerts (stack_name, metric, operator, threshold, duration_mins, cooldown_mins, last_fired_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        const result = stmt.run(
            alert.stack_name,
            alert.metric,
            alert.operator,
            alert.threshold,
            alert.duration_mins,
            alert.cooldown_mins,
            alert.last_fired_at || 0
        );
        return this.db.prepare('SELECT * FROM stack_alerts WHERE id = ?').get(result.lastInsertRowid) as StackAlert;
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

    public updateNotificationDispatchError(id: number, error: string): void {
        this.db.prepare('UPDATE notification_history SET dispatch_error = ? WHERE id = ?').run(error, id);
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
        // Aggregate into 5-minute buckets (300000ms) to keep response size bounded.
        // With 24h lookback that's ~288 buckets per container instead of ~1440.
        const bucketMs = 300000;
        const stmt = this.db.prepare(`
            SELECT
              container_id,
              stack_name,
              AVG(cpu_percent) as cpu_percent,
              AVG(memory_mb) as memory_mb,
              MAX(net_rx_mb) as net_rx_mb,
              MAX(net_tx_mb) as net_tx_mb,
              (timestamp / ${bucketMs}) * ${bucketMs} as timestamp
            FROM container_metrics
            WHERE timestamp >= ?
            GROUP BY container_id, stack_name, (timestamp / ${bucketMs})
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

    private decryptNodeRow(row: any): Node {
        const crypto = CryptoService.getInstance();
        return {
            ...row,
            is_default: row.is_default === 1,
            api_token: row.api_token ? crypto.decrypt(row.api_token) : '',
        };
    }

    public getNodes(): Node[] {
        const stmt = this.db.prepare('SELECT id, name, type, compose_dir, is_default, status, created_at, api_url, api_token FROM nodes ORDER BY is_default DESC, name ASC');
        return stmt.all().map((row: any) => this.decryptNodeRow(row));
    }

    public getNode(id: number): Node | undefined {
        const stmt = this.db.prepare('SELECT id, name, type, compose_dir, is_default, status, created_at, api_url, api_token FROM nodes WHERE id = ?');
        const row = stmt.get(id) as any;
        if (!row) return undefined;
        return this.decryptNodeRow(row);
    }

    public getDefaultNode(): Node | undefined {
        const stmt = this.db.prepare('SELECT id, name, type, compose_dir, is_default, status, created_at, api_url, api_token FROM nodes WHERE is_default = 1 LIMIT 1');
        const row = stmt.get() as any;
        if (!row) return undefined;
        return this.decryptNodeRow(row);
    }

    public addNode(node: Omit<Node, 'id' | 'status' | 'created_at'>): number {
        if (node.is_default) {
            this.db.prepare('UPDATE nodes SET is_default = 0').run();
        }
        const crypto = CryptoService.getInstance();
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
            node.api_token ? crypto.encrypt(node.api_token) : ''
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
        if (updates.api_token !== undefined) {
            fields.push('api_token = ?');
            values.push(updates.api_token ? CryptoService.getInstance().encrypt(updates.api_token) : '');
        }

        if (fields.length === 0) return;

        values.push(id);
        this.db.prepare(`UPDATE nodes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteNode(id: number): void {
        const node = this.getNode(id);
        if (node?.is_default) {
            throw new Error('Cannot delete the default node');
        }
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM scheduled_task_runs WHERE task_id IN (SELECT id FROM scheduled_tasks WHERE node_id = ?)').run(id);
            this.db.prepare('DELETE FROM scheduled_tasks WHERE node_id = ?').run(id);
            this.db.prepare('DELETE FROM stack_update_status WHERE node_id = ?').run(id);
            this.db.prepare('DELETE FROM stack_label_assignments WHERE node_id = ?').run(id);
            this.db.prepare('DELETE FROM stack_labels WHERE node_id = ?').run(id);
            this.deleteRoleAssignmentsByResource('node', String(id));
            this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
        })();
    }

    public updateNodeStatus(id: number, status: 'online' | 'offline' | 'unknown'): void {
        this.db.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(status, id);
    }

    // --- Stack Update Status ---

    public upsertStackUpdateStatus(nodeId: number, stackName: string, hasUpdate: boolean, checkedAt: number): void {
        this.db.prepare(
            `INSERT INTO stack_update_status (node_id, stack_name, has_update, checked_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(node_id, stack_name) DO UPDATE SET has_update = excluded.has_update, checked_at = excluded.checked_at`
        ).run(nodeId, stackName, hasUpdate ? 1 : 0, checkedAt);
    }

    public getStackUpdateStatus(nodeId?: number): Record<string, boolean> {
        const rows = nodeId !== undefined
            ? this.db.prepare('SELECT stack_name, has_update FROM stack_update_status WHERE node_id = ?').all(nodeId) as Array<{ stack_name: string; has_update: number }>
            : this.db.prepare('SELECT stack_name, has_update FROM stack_update_status').all() as Array<{ stack_name: string; has_update: number }>;
        const result: Record<string, boolean> = {};
        for (const row of rows) {
            result[row.stack_name] = row.has_update === 1;
        }
        return result;
    }

    public clearStackUpdateStatus(nodeId: number, stackName: string): void {
        this.db.prepare('DELETE FROM stack_update_status WHERE node_id = ? AND stack_name = ?').run(nodeId, stackName);
    }

    public getNodeUpdateSummary(): Array<{ node_id: number; stacks_with_updates: number }> {
        return this.db.prepare(
            'SELECT node_id, SUM(has_update) as stacks_with_updates FROM stack_update_status WHERE has_update = 1 GROUP BY node_id'
        ).all() as Array<{ node_id: number; stacks_with_updates: number }>;
    }

    public getNodeSchedulingSummary(): Array<{
        node_id: number;
        active_tasks: number;
        auto_update_enabled: number;
        next_run_at: number | null;
    }> {
        return this.db.prepare(`
            SELECT
                node_id,
                COUNT(*) as active_tasks,
                MAX(CASE WHEN action = 'update' AND enabled = 1 THEN 1 ELSE 0 END) as auto_update_enabled,
                MIN(next_run_at) as next_run_at
            FROM scheduled_tasks
            WHERE enabled = 1 AND node_id IS NOT NULL
            GROUP BY node_id
        `).all() as Array<{ node_id: number; active_tasks: number; auto_update_enabled: number; next_run_at: number | null }>;
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
        return this.db.prepare('SELECT id, username, role, auth_provider, provider_id, email, created_at, updated_at FROM users ORDER BY created_at ASC').all() as Omit<User, 'password_hash'>[];
    }

    public getUser(id: number): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    }

    public getUserByUsername(username: string): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
    }

    public getUserById(id: number): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    }

    public getUserByProviderIdentity(authProvider: string, providerId: string): User | undefined {
        return this.db.prepare('SELECT * FROM users WHERE auth_provider = ? AND provider_id = ?').get(authProvider, providerId) as User | undefined;
    }

    public addUser(user: { username: string; password_hash: string; role: UserRole; auth_provider?: AuthProvider; provider_id?: string | null; email?: string | null }): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO users (username, password_hash, role, auth_provider, provider_id, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(user.username, user.password_hash, user.role, user.auth_provider ?? 'local', user.provider_id ?? null, user.email ?? null, now, now);
        return result.lastInsertRowid as number;
    }

    public updateUser(id: number, updates: Partial<{ username: string; password_hash: string; role: string; email: string }>): void {
        const fields: string[] = [];
        const values: (string | number)[] = [];

        if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username); }
        if (updates.password_hash !== undefined) { fields.push('password_hash = ?'); values.push(updates.password_hash); }
        if (updates.role !== undefined) { fields.push('role = ?'); values.push(updates.role); }
        if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }

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

    public getNonAdminCount(): number {
        return (this.db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin'").get() as { count: number })?.count || 0;
    }

    public bumpTokenVersion(userId: number): void {
        this.db.prepare('UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?').run(Date.now(), userId);
    }

    // --- User MFA ---

    public getUserMfa(userId: number): UserMfa | undefined {
        return this.db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) as UserMfa | undefined;
    }

    /**
     * Create or merge a user_mfa row. Any field left undefined on the update
     * object is preserved. Boolean flags are normalized to 0/1.
     */
    public upsertUserMfa(userId: number, updates: UserMfaUpdate): void {
        const now = Date.now();
        const existing = this.getUserMfa(userId);

        if (!existing) {
            this.db.prepare(
                `INSERT INTO user_mfa
                  (user_id, enabled, totp_secret_encrypted, backup_codes_json, sso_enforce_mfa,
                   failed_attempts, locked_until, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                userId,
                updates.enabled ? 1 : 0,
                updates.totp_secret_encrypted ?? null,
                updates.backup_codes_json ?? null,
                updates.sso_enforce_mfa ? 1 : 0,
                updates.failed_attempts ?? 0,
                updates.locked_until ?? null,
                now,
                now,
            );
            return;
        }

        const fields: string[] = [];
        const values: (string | number | null)[] = [];
        if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
        if (updates.totp_secret_encrypted !== undefined) { fields.push('totp_secret_encrypted = ?'); values.push(updates.totp_secret_encrypted); }
        if (updates.backup_codes_json !== undefined) { fields.push('backup_codes_json = ?'); values.push(updates.backup_codes_json); }
        if (updates.sso_enforce_mfa !== undefined) { fields.push('sso_enforce_mfa = ?'); values.push(updates.sso_enforce_mfa ? 1 : 0); }
        if (updates.failed_attempts !== undefined) { fields.push('failed_attempts = ?'); values.push(updates.failed_attempts); }
        if (updates.locked_until !== undefined) { fields.push('locked_until = ?'); values.push(updates.locked_until); }

        if (fields.length === 0) return;

        fields.push('updated_at = ?');
        values.push(now);
        values.push(userId);
        this.db.prepare(`UPDATE user_mfa SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
    }

    public deleteUserMfa(userId: number): void {
        this.db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
        this.db.prepare('DELETE FROM mfa_used_tokens WHERE user_id = ?').run(userId);
    }

    /**
     * Single-query helper to enrich a user list with MFA status without the
     * N+1 cost of calling getUserMfa() per row.
     */
    public getUsersWithMfaEnabled(): Set<number> {
        const rows = this.db.prepare('SELECT user_id FROM user_mfa WHERE enabled = 1').all() as { user_id: number }[];
        return new Set(rows.map((r) => r.user_id));
    }

    public recordMfaFailure(userId: number): number {
        const row = this.db.prepare(
            `UPDATE user_mfa
                SET failed_attempts = failed_attempts + 1,
                    updated_at = ?
              WHERE user_id = ?
          RETURNING failed_attempts`
        ).get(Date.now(), userId) as { failed_attempts: number } | undefined;
        return row?.failed_attempts ?? 0;
    }

    public clearMfaFailures(userId: number): void {
        this.db.prepare(
            `UPDATE user_mfa
                SET failed_attempts = 0,
                    locked_until = NULL,
                    updated_at = ?
              WHERE user_id = ?`
        ).run(Date.now(), userId);
    }

    public lockMfa(userId: number, untilMs: number): void {
        this.db.prepare(
            `UPDATE user_mfa SET locked_until = ?, updated_at = ? WHERE user_id = ?`
        ).run(untilMs, Date.now(), userId);
    }

    public isMfaCodeUsed(userId: number, code: string, window: number): boolean {
        const row = this.db.prepare(
            'SELECT 1 FROM mfa_used_tokens WHERE user_id = ? AND code = ? AND window = ?'
        ).get(userId, code, window);
        return !!row;
    }

    public markMfaCodeUsed(userId: number, code: string, window: number): void {
        this.db.prepare(
            'INSERT OR IGNORE INTO mfa_used_tokens (user_id, code, window, used_at) VALUES (?, ?, ?, ?)'
        ).run(userId, code, window, Date.now());
    }

    public purgeOldMfaCodes(olderThanMs: number): number {
        const result = this.db.prepare('DELETE FROM mfa_used_tokens WHERE used_at < ?').run(olderThanMs);
        return result.changes;
    }

    // --- Role Assignments ---

    public getRoleAssignments(userId: number, resourceType: ResourceType, resourceId: string): RoleAssignment[] {
        return this.db.prepare(
            'SELECT * FROM role_assignments WHERE user_id = ? AND resource_type = ? AND resource_id = ?'
        ).all(userId, resourceType, resourceId) as RoleAssignment[];
    }

    public getAllRoleAssignments(userId: number): RoleAssignment[] {
        return this.db.prepare(
            'SELECT * FROM role_assignments WHERE user_id = ? ORDER BY resource_type, resource_id'
        ).all(userId) as RoleAssignment[];
    }

    public addRoleAssignment(assignment: { user_id: number; role: UserRole; resource_type: ResourceType; resource_id: string }): number {
        const now = Date.now();
        const result = this.db.prepare(
            'INSERT INTO role_assignments (user_id, role, resource_type, resource_id, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(assignment.user_id, assignment.role, assignment.resource_type, assignment.resource_id, now);
        return result.lastInsertRowid as number;
    }

    public getRoleAssignmentById(id: number): RoleAssignment | undefined {
        return this.db.prepare('SELECT * FROM role_assignments WHERE id = ?').get(id) as RoleAssignment | undefined;
    }

    public deleteRoleAssignment(id: number): void {
        this.db.prepare('DELETE FROM role_assignments WHERE id = ?').run(id);
    }

    public deleteRoleAssignmentsByUser(userId: number): void {
        this.db.prepare('DELETE FROM role_assignments WHERE user_id = ?').run(userId);
    }

    public deleteRoleAssignmentsByResource(resourceType: ResourceType, resourceId: string): void {
        this.db.prepare('DELETE FROM role_assignments WHERE resource_type = ? AND resource_id = ?').run(resourceType, resourceId);
    }

    // --- SSO Config ---

    public getSSOConfigs(): SSOConfig[] {
        return this.db.prepare('SELECT * FROM sso_config ORDER BY provider ASC').all() as SSOConfig[];
    }

    public getSSOConfig(provider: string): SSOConfig | undefined {
        return this.db.prepare('SELECT * FROM sso_config WHERE provider = ?').get(provider) as SSOConfig | undefined;
    }

    public getEnabledSSOConfigs(): SSOConfig[] {
        return this.db.prepare('SELECT * FROM sso_config WHERE enabled = 1 ORDER BY provider ASC').all() as SSOConfig[];
    }

    public upsertSSOConfig(provider: string, enabled: boolean, configJson: string): void {
        const now = Date.now();
        const existing = this.getSSOConfig(provider);
        if (existing) {
            this.db.prepare('UPDATE sso_config SET enabled = ?, config_json = ?, updated_at = ? WHERE provider = ?')
                .run(enabled ? 1 : 0, configJson, now, provider);
        } else {
            this.db.prepare('INSERT INTO sso_config (provider, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
                .run(provider, enabled ? 1 : 0, configJson, now, now);
        }
    }

    public deleteSSOConfig(provider: string): void {
        this.db.prepare('DELETE FROM sso_config WHERE provider = ?').run(provider);
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

    // --- Audit Log ---

    public insertAuditLog(entry: Omit<AuditLogEntry, 'id'>): void {
        this.db.prepare(
            'INSERT INTO audit_log (timestamp, username, method, path, status_code, node_id, ip_address, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(entry.timestamp, entry.username, entry.method, entry.path, entry.status_code, entry.node_id, entry.ip_address, entry.summary);
    }

    public getAuditLogs(filters: {
        page?: number;
        limit?: number;
        username?: string;
        method?: string;
        from?: number;
        to?: number;
        search?: string;
    } = {}): { entries: AuditLogEntry[]; total: number } {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 50;
        const offset = (page - 1) * limit;

        const conditions: string[] = [];
        const params: (string | number)[] = [];

        if (filters.username) {
            conditions.push('username = ?');
            params.push(filters.username);
        }
        if (filters.method) {
            conditions.push('method = ?');
            params.push(filters.method);
        }
        if (filters.from) {
            conditions.push('timestamp >= ?');
            params.push(filters.from);
        }
        if (filters.to) {
            conditions.push('timestamp <= ?');
            params.push(filters.to);
        }
        if (filters.search) {
            conditions.push('(summary LIKE ? OR path LIKE ? OR username LIKE ?)');
            const term = `%${filters.search}%`;
            params.push(term, term, term);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const total = (this.db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params) as { count: number })?.count || 0;
        const entries = this.db.prepare(
            `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
        ).all(...params, limit, offset) as AuditLogEntry[];

        return { entries, total };
    }

    public cleanupOldAuditLogs(daysToKeep = 90): void {
        const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        this.db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff);
    }

    // --- API Tokens ---

    public addApiToken(token: Omit<ApiToken, 'id' | 'last_used_at' | 'revoked_at'>): number {
        const result = this.db.prepare(
            'INSERT INTO api_tokens (token_hash, name, scope, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(token.token_hash, token.name, token.scope, token.user_id, token.created_at, token.expires_at);
        return result.lastInsertRowid as number;
    }

    public getApiTokensByUser(userId: number): ApiToken[] {
        return this.db.prepare(
            'SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC'
        ).all(userId) as ApiToken[];
    }

    public getApiTokenByHash(tokenHash: string): ApiToken | undefined {
        return this.db.prepare(
            'SELECT * FROM api_tokens WHERE token_hash = ?'
        ).get(tokenHash) as ApiToken | undefined;
    }

    public getApiTokenById(id: number): ApiToken | undefined {
        return this.db.prepare(
            'SELECT * FROM api_tokens WHERE id = ?'
        ).get(id) as ApiToken | undefined;
    }

    public revokeApiToken(id: number): void {
        this.db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(Date.now(), id);
    }

    public updateApiTokenLastUsed(id: number): void {
        this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
    }

    public getActiveApiTokenCountByUser(userId: number): number {
        const row = this.db.prepare(
            'SELECT COUNT(*) AS cnt FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL'
        ).get(userId) as { cnt: number };
        return row.cnt;
    }

    public getActiveApiTokenByNameAndUser(name: string, userId: number): ApiToken | undefined {
        return this.db.prepare(
            'SELECT * FROM api_tokens WHERE name = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1'
        ).get(name, userId) as ApiToken | undefined;
    }

    // --- Registries ---

    public getRegistries(): Registry[] {
        return this.db.prepare('SELECT * FROM registries ORDER BY name ASC').all() as Registry[];
    }

    public getRegistry(id: number): Registry | undefined {
        return this.db.prepare('SELECT * FROM registries WHERE id = ?').get(id) as Registry | undefined;
    }

    public addRegistry(reg: Omit<Registry, 'id'>): number {
        const result = this.db.prepare(
            'INSERT INTO registries (name, url, type, username, secret, aws_region, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(reg.name, reg.url, reg.type, reg.username, reg.secret, reg.aws_region, reg.created_at, reg.updated_at);
        return result.lastInsertRowid as number;
    }

    public updateRegistry(id: number, updates: Partial<Omit<Registry, 'id' | 'created_at'>>): void {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.url !== undefined) { fields.push('url = ?'); values.push(updates.url); }
        if (updates.type !== undefined) { fields.push('type = ?'); values.push(updates.type); }
        if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username); }
        if (updates.secret !== undefined) { fields.push('secret = ?'); values.push(updates.secret); }
        if (updates.aws_region !== undefined) { fields.push('aws_region = ?'); values.push(updates.aws_region); }
        if (updates.updated_at !== undefined) { fields.push('updated_at = ?'); values.push(updates.updated_at); }

        if (fields.length === 0) return;

        values.push(id);
        this.db.prepare(`UPDATE registries SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteRegistry(id: number): void {
        this.db.prepare('DELETE FROM registries WHERE id = ?').run(id);
    }

    // --- Stack Git Sources ---

    private parseGitSource(row: Record<string, unknown> | undefined): StackGitSource | undefined {
        if (!row) return undefined;
        return {
            id: row.id as number,
            stack_name: row.stack_name as string,
            repo_url: row.repo_url as string,
            branch: row.branch as string,
            compose_path: row.compose_path as string,
            sync_env: Number(row.sync_env) === 1,
            env_path: (row.env_path as string | null) ?? null,
            auth_type: row.auth_type as GitSourceAuthType,
            encrypted_token: (row.encrypted_token as string | null) ?? null,
            auto_apply_on_webhook: Number(row.auto_apply_on_webhook) === 1,
            auto_deploy_on_apply: Number(row.auto_deploy_on_apply) === 1,
            last_applied_commit_sha: (row.last_applied_commit_sha as string | null) ?? null,
            last_applied_content_hash: (row.last_applied_content_hash as string | null) ?? null,
            pending_commit_sha: (row.pending_commit_sha as string | null) ?? null,
            pending_compose_content: (row.pending_compose_content as string | null) ?? null,
            pending_env_content: (row.pending_env_content as string | null) ?? null,
            pending_fetched_at: (row.pending_fetched_at as number | null) ?? null,
            last_debounce_at: (row.last_debounce_at as number | null) ?? null,
            created_at: row.created_at as number,
            updated_at: row.updated_at as number,
        };
    }

    public getGitSource(stackName: string): StackGitSource | undefined {
        const row = this.db.prepare('SELECT * FROM stack_git_sources WHERE stack_name = ?').get(stackName) as Record<string, unknown> | undefined;
        return this.parseGitSource(row);
    }

    public getGitSources(): StackGitSource[] {
        const rows = this.db.prepare('SELECT * FROM stack_git_sources ORDER BY stack_name ASC').all() as Record<string, unknown>[];
        return rows.map(r => this.parseGitSource(r)!);
    }

    public upsertGitSource(source: Omit<StackGitSource, 'id' | 'created_at' | 'updated_at'>): number {
        const now = Date.now();
        const existing = this.getGitSource(source.stack_name);
        if (existing) {
            this.db.prepare(
                `UPDATE stack_git_sources SET
                    repo_url = ?, branch = ?, compose_path = ?, sync_env = ?, env_path = ?,
                    auth_type = ?, encrypted_token = ?,
                    auto_apply_on_webhook = ?, auto_deploy_on_apply = ?,
                    updated_at = ?
                 WHERE stack_name = ?`
            ).run(
                source.repo_url, source.branch, source.compose_path,
                source.sync_env ? 1 : 0, source.env_path,
                source.auth_type, source.encrypted_token,
                source.auto_apply_on_webhook ? 1 : 0, source.auto_deploy_on_apply ? 1 : 0,
                now, source.stack_name
            );
            return existing.id!;
        }
        const result = this.db.prepare(
            `INSERT INTO stack_git_sources
                (stack_name, repo_url, branch, compose_path, sync_env, env_path,
                 auth_type, encrypted_token, auto_apply_on_webhook, auto_deploy_on_apply,
                 created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            source.stack_name, source.repo_url, source.branch, source.compose_path,
            source.sync_env ? 1 : 0, source.env_path,
            source.auth_type, source.encrypted_token,
            source.auto_apply_on_webhook ? 1 : 0, source.auto_deploy_on_apply ? 1 : 0,
            now, now
        );
        return result.lastInsertRowid as number;
    }

    public deleteGitSource(stackName: string): void {
        this.db.prepare('DELETE FROM stack_git_sources WHERE stack_name = ?').run(stackName);
    }

    public setGitSourcePending(stackName: string, commitSha: string, composeContent: string, envContent: string | null): void {
        this.db.prepare(
            `UPDATE stack_git_sources SET
                pending_commit_sha = ?,
                pending_compose_content = ?,
                pending_env_content = ?,
                pending_fetched_at = ?,
                updated_at = ?
             WHERE stack_name = ?`
        ).run(commitSha, composeContent, envContent, Date.now(), Date.now(), stackName);
    }

    public clearGitSourcePending(stackName: string): void {
        this.db.prepare(
            `UPDATE stack_git_sources SET
                pending_commit_sha = NULL,
                pending_compose_content = NULL,
                pending_env_content = NULL,
                pending_fetched_at = NULL,
                updated_at = ?
             WHERE stack_name = ?`
        ).run(Date.now(), stackName);
    }

    public markGitSourceApplied(stackName: string, commitSha: string, contentHash: string): void {
        this.db.prepare(
            `UPDATE stack_git_sources SET
                last_applied_commit_sha = ?,
                last_applied_content_hash = ?,
                pending_commit_sha = NULL,
                pending_compose_content = NULL,
                pending_env_content = NULL,
                pending_fetched_at = NULL,
                updated_at = ?
             WHERE stack_name = ?`
        ).run(commitSha, contentHash, Date.now(), stackName);
    }

    public touchGitSourceDebounce(stackName: string): void {
        this.db.prepare('UPDATE stack_git_sources SET last_debounce_at = ? WHERE stack_name = ?')
            .run(Date.now(), stackName);
    }

    // --- Scheduled Tasks ---

    public getScheduledTasks(): ScheduledTask[] {
        return this.db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTask[];
    }

    public getScheduledTask(id: number): ScheduledTask | undefined {
        return this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask | undefined;
    }

    public createScheduledTask(task: Omit<ScheduledTask, 'id'>): number {
        const result = this.db.prepare(
            'INSERT INTO scheduled_tasks (name, target_type, target_id, node_id, action, cron_expression, enabled, created_by, created_at, updated_at, last_run_at, next_run_at, last_status, last_error, prune_targets, target_services, prune_label_filter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
            task.name, task.target_type, task.target_id, task.node_id,
            task.action, task.cron_expression, task.enabled, task.created_by,
            task.created_at, task.updated_at, task.last_run_at, task.next_run_at,
            task.last_status, task.last_error, task.prune_targets, task.target_services,
            task.prune_label_filter
        );
        return result.lastInsertRowid as number;
    }

    public updateScheduledTask(id: number, updates: Partial<Omit<ScheduledTask, 'id'>>): void {
        const fields: string[] = [];
        const values: unknown[] = [];

        const map: Record<string, unknown> = {
            name: updates.name, target_type: updates.target_type, target_id: updates.target_id,
            node_id: updates.node_id, action: updates.action, cron_expression: updates.cron_expression,
            enabled: updates.enabled, created_by: updates.created_by, updated_at: updates.updated_at,
            last_run_at: updates.last_run_at, next_run_at: updates.next_run_at,
            last_status: updates.last_status, last_error: updates.last_error,
            prune_targets: updates.prune_targets, target_services: updates.target_services,
            prune_label_filter: updates.prune_label_filter,
        };

        for (const [col, val] of Object.entries(map)) {
            if (val !== undefined) {
                fields.push(`${col} = ?`);
                values.push(val);
            }
        }

        if (fields.length === 0) return;
        values.push(id);
        this.db.prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public deleteScheduledTask(id: number): void {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM scheduled_task_runs WHERE task_id = ?').run(id);
            this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
        })();
    }

    public getDueScheduledTasks(now: number): ScheduledTask[] {
        return this.db.prepare(
            'SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
        ).all(now) as ScheduledTask[];
    }

    public getScheduledTaskRuns(taskId: number, limit = 20, offset = 0): { runs: ScheduledTaskRun[]; total: number } {
        const runs = this.db.prepare(
            'SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?'
        ).all(taskId, limit, offset) as ScheduledTaskRun[];
        const { total } = this.db.prepare(
            'SELECT COUNT(*) as total FROM scheduled_task_runs WHERE task_id = ?'
        ).get(taskId) as { total: number };
        return { runs, total };
    }

    public createScheduledTaskRun(run: Omit<ScheduledTaskRun, 'id'>): number {
        const result = this.db.prepare(
            'INSERT INTO scheduled_task_runs (task_id, started_at, completed_at, status, output, error, triggered_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(run.task_id, run.started_at, run.completed_at, run.status, run.output, run.error, run.triggered_by);
        return result.lastInsertRowid as number;
    }

    public updateScheduledTaskRun(id: number, updates: Partial<Omit<ScheduledTaskRun, 'id' | 'task_id'>>): void {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (updates.completed_at !== undefined) { fields.push('completed_at = ?'); values.push(updates.completed_at); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output); }
        if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }

        if (fields.length === 0) return;
        values.push(id);
        this.db.prepare(`UPDATE scheduled_task_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    public getAllScheduledTaskRuns(taskId: number): ScheduledTaskRun[] {
        return this.db.prepare(
            'SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC'
        ).all(taskId) as ScheduledTaskRun[];
    }

    public markStaleRunsAsFailed(): number {
        const result = this.db.prepare(
            'UPDATE scheduled_task_runs SET status = ?, completed_at = ?, error = ? WHERE status = ?'
        ).run('failure', Date.now(), 'Server restarted during execution', 'running');
        return result.changes;
    }

    public cleanupOldTaskRuns(retentionDays = 30): void {
        const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
        this.db.prepare('DELETE FROM scheduled_task_runs WHERE started_at < ?').run(cutoff);
    }

    // --- Vulnerability Scans ---

    public createVulnerabilityScan(
        scan: Omit<VulnerabilityScan, 'id'>,
    ): number {
        const stmt = this.db.prepare(
            `INSERT INTO vulnerability_scans (
                node_id, image_ref, image_digest, scanned_at,
                total_vulnerabilities, critical_count, high_count, medium_count,
                low_count, unknown_count, fixable_count, highest_severity,
                os_info, trivy_version, scan_duration_ms, triggered_by, status,
                error, stack_context
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const result = stmt.run(
            scan.node_id,
            scan.image_ref,
            scan.image_digest,
            scan.scanned_at,
            scan.total_vulnerabilities,
            scan.critical_count,
            scan.high_count,
            scan.medium_count,
            scan.low_count,
            scan.unknown_count,
            scan.fixable_count,
            scan.highest_severity,
            scan.os_info,
            scan.trivy_version,
            scan.scan_duration_ms,
            scan.triggered_by,
            scan.status,
            scan.error,
            scan.stack_context,
        );
        return result.lastInsertRowid as number;
    }

    public updateVulnerabilityScan(
        id: number,
        updates: Partial<Omit<VulnerabilityScan, 'id'>>,
    ): void {
        const ALLOWED_COLUMNS = new Set([
            'node_id', 'image_ref', 'image_digest', 'scanned_at',
            'total_vulnerabilities', 'critical_count', 'high_count',
            'medium_count', 'low_count', 'unknown_count', 'fixable_count',
            'highest_severity', 'os_info', 'trivy_version', 'scan_duration_ms',
            'triggered_by', 'status', 'error', 'stack_context',
        ]);
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
            if (!ALLOWED_COLUMNS.has(key)) continue;
            fields.push(`${key} = ?`);
            values.push(value);
        }
        if (fields.length === 0) return;
        values.push(id);
        this.db
            .prepare(`UPDATE vulnerability_scans SET ${fields.join(', ')} WHERE id = ?`)
            .run(...(values as never[]));
    }

    public getVulnerabilityScan(id: number): VulnerabilityScan | null {
        return (
            (this.db
                .prepare('SELECT * FROM vulnerability_scans WHERE id = ?')
                .get(id) as VulnerabilityScan | undefined) ?? null
        );
    }

    public getVulnerabilityScans(
        nodeId: number,
        opts: { imageRef?: string; limit?: number; offset?: number } = {},
    ): { items: VulnerabilityScan[]; total: number } {
        const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
        const offset = Math.max(0, opts.offset ?? 0);
        const where = ['node_id = ?'];
        const params: unknown[] = [nodeId];
        if (opts.imageRef) {
            where.push('image_ref = ?');
            params.push(opts.imageRef);
        }
        const whereSql = where.join(' AND ');
        const total = (
            this.db
                .prepare(`SELECT COUNT(*) as cnt FROM vulnerability_scans WHERE ${whereSql}`)
                .get(...(params as never[])) as { cnt: number }
        ).cnt;
        const items = this.db
            .prepare(
                `SELECT * FROM vulnerability_scans WHERE ${whereSql} ORDER BY scanned_at DESC LIMIT ? OFFSET ?`,
            )
            .all(...(params as never[]), limit, offset) as VulnerabilityScan[];
        return { items, total };
    }

    public getLatestScanForImage(
        nodeId: number,
        imageRef: string,
    ): VulnerabilityScan | null {
        return (
            (this.db
                .prepare(
                    'SELECT * FROM vulnerability_scans WHERE node_id = ? AND image_ref = ? ORDER BY scanned_at DESC LIMIT 1',
                )
                .get(nodeId, imageRef) as VulnerabilityScan | undefined) ?? null
        );
    }

    public getLatestScanByDigest(digest: string): VulnerabilityScan | null {
        if (!digest) return null;
        return (
            (this.db
                .prepare(
                    "SELECT * FROM vulnerability_scans WHERE image_digest = ? AND status = 'completed' ORDER BY scanned_at DESC LIMIT 1",
                )
                .get(digest) as VulnerabilityScan | undefined) ?? null
        );
    }

    public deleteOldScans(olderThanMs: number): number {
        const cutoff = Date.now() - olderThanMs;
        const result = this.db
            .prepare('DELETE FROM vulnerability_scans WHERE scanned_at < ?')
            .run(cutoff);
        return result.changes;
    }

    public markStaleScansAsFailed(olderThanMs: number): number {
        const cutoff = Date.now() - olderThanMs;
        const result = this.db
            .prepare(
                `UPDATE vulnerability_scans
                 SET status = 'failed',
                     error = 'Scan did not complete within expected time',
                     scan_duration_ms = ? - scanned_at
                 WHERE status = 'in_progress' AND scanned_at < ?`,
            )
            .run(Date.now(), cutoff);
        return result.changes;
    }

    public isImageBeingScanned(nodeId: number, imageRef: string): boolean {
        const row = this.db
            .prepare(
                "SELECT id FROM vulnerability_scans WHERE node_id = ? AND image_ref = ? AND status = 'in_progress' LIMIT 1",
            )
            .get(nodeId, imageRef);
        return !!row;
    }

    public insertVulnerabilityDetails(
        scanId: number,
        details: Array<Omit<VulnerabilityDetail, 'id' | 'scan_id'>>,
    ): void {
        if (details.length === 0) return;
        const stmt = this.db.prepare(
            `INSERT INTO vulnerability_details (
                scan_id, vulnerability_id, pkg_name, installed_version,
                fixed_version, severity, title, description, primary_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const txn = this.db.transaction((rows: typeof details) => {
            for (const d of rows) {
                stmt.run(
                    scanId,
                    d.vulnerability_id,
                    d.pkg_name,
                    d.installed_version,
                    d.fixed_version,
                    d.severity,
                    d.title,
                    d.description,
                    d.primary_url,
                );
            }
        });
        txn(details);
    }

    public getVulnerabilityDetails(
        scanId: number,
        opts: { severity?: VulnSeverity; limit?: number; offset?: number } = {},
    ): { items: VulnerabilityDetail[]; total: number } {
        const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
        const offset = Math.max(0, opts.offset ?? 0);
        const where = ['scan_id = ?'];
        const params: unknown[] = [scanId];
        if (opts.severity) {
            where.push('severity = ?');
            params.push(opts.severity);
        }
        const whereSql = where.join(' AND ');
        const total = (
            this.db
                .prepare(`SELECT COUNT(*) as cnt FROM vulnerability_details WHERE ${whereSql}`)
                .get(...(params as never[])) as { cnt: number }
        ).cnt;
        const severityOrder = `CASE severity
            WHEN 'CRITICAL' THEN 0
            WHEN 'HIGH' THEN 1
            WHEN 'MEDIUM' THEN 2
            WHEN 'LOW' THEN 3
            ELSE 4 END`;
        const items = this.db
            .prepare(
                `SELECT * FROM vulnerability_details WHERE ${whereSql} ORDER BY ${severityOrder}, pkg_name LIMIT ? OFFSET ?`,
            )
            .all(...(params as never[]), limit, offset) as VulnerabilityDetail[];
        return { items, total };
    }

    public getImageScanSummaries(nodeId: number): Record<string, ScanSummary> {
        const rows = this.db
            .prepare(
                `SELECT vs.image_ref, vs.id as scan_id, vs.highest_severity, vs.total_vulnerabilities,
                    vs.critical_count, vs.high_count, vs.medium_count, vs.low_count,
                    vs.unknown_count, vs.fixable_count, vs.scanned_at
                 FROM vulnerability_scans vs
                 INNER JOIN (
                   SELECT image_ref, MAX(scanned_at) AS max_scanned
                   FROM vulnerability_scans
                   WHERE node_id = ? AND status = 'completed'
                   GROUP BY image_ref
                 ) latest ON latest.image_ref = vs.image_ref AND latest.max_scanned = vs.scanned_at
                 WHERE vs.node_id = ? AND vs.status = 'completed'`,
            )
            .all(nodeId, nodeId) as Array<{
                image_ref: string;
                scan_id: number;
                highest_severity: VulnSeverity | null;
                total_vulnerabilities: number;
                critical_count: number;
                high_count: number;
                medium_count: number;
                low_count: number;
                unknown_count: number;
                fixable_count: number;
                scanned_at: number;
            }>;
        const out: Record<string, ScanSummary> = {};
        for (const r of rows) {
            out[r.image_ref] = {
                image_ref: r.image_ref,
                highest_severity: r.highest_severity,
                total: r.total_vulnerabilities,
                critical: r.critical_count,
                high: r.high_count,
                medium: r.medium_count,
                low: r.low_count,
                unknown: r.unknown_count,
                fixable: r.fixable_count,
                scanned_at: r.scanned_at,
                scan_id: r.scan_id,
            };
        }
        return out;
    }

    // --- Scan Policies ---

    public getScanPolicies(): ScanPolicy[] {
        return this.db
            .prepare('SELECT * FROM scan_policies ORDER BY created_at DESC')
            .all() as ScanPolicy[];
    }

    public getScanPolicy(id: number): ScanPolicy | null {
        return (
            (this.db
                .prepare('SELECT * FROM scan_policies WHERE id = ?')
                .get(id) as ScanPolicy | undefined) ?? null
        );
    }

    public createScanPolicy(
        policy: Omit<ScanPolicy, 'id' | 'created_at' | 'updated_at'>,
    ): ScanPolicy {
        const now = Date.now();
        const result = this.db
            .prepare(
                `INSERT INTO scan_policies (name, node_id, stack_pattern, max_severity, block_on_deploy, enabled, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                policy.name,
                policy.node_id,
                policy.stack_pattern,
                policy.max_severity,
                policy.block_on_deploy,
                policy.enabled,
                now,
                now,
            );
        return { ...policy, id: result.lastInsertRowid as number, created_at: now, updated_at: now };
    }

    public updateScanPolicy(
        id: number,
        updates: Partial<Omit<ScanPolicy, 'id' | 'created_at' | 'updated_at'>>,
    ): ScanPolicy | null {
        const existing = this.getScanPolicy(id);
        if (!existing) return null;
        const ALLOWED_COLUMNS = new Set([
            'name', 'node_id', 'stack_pattern', 'max_severity',
            'block_on_deploy', 'enabled',
        ]);
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(updates)) {
            if (!ALLOWED_COLUMNS.has(key)) continue;
            fields.push(`${key} = ?`);
            values.push(value);
        }
        if (fields.length === 0) return existing;
        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);
        this.db
            .prepare(`UPDATE scan_policies SET ${fields.join(', ')} WHERE id = ?`)
            .run(...(values as never[]));
        return this.getScanPolicy(id);
    }

    public deleteScanPolicy(id: number): void {
        this.db.prepare('DELETE FROM scan_policies WHERE id = ?').run(id);
    }

    public getMatchingPolicy(
        nodeId: number,
        stackName: string | null,
    ): ScanPolicy | null {
        const policies = this.db
            .prepare(
                'SELECT * FROM scan_policies WHERE enabled = 1 AND (node_id IS NULL OR node_id = ?)',
            )
            .all(nodeId) as ScanPolicy[];
        const matchesStack = (pattern: string | null): boolean => {
            if (!pattern) return true;
            if (!stackName) return false;
            const regex = new RegExp(
                '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
            );
            return regex.test(stackName);
        };
        const scoped = policies.filter((p) => matchesStack(p.stack_pattern));
        if (scoped.length === 0) return null;
        scoped.sort((a, b) => {
            if (a.node_id && !b.node_id) return -1;
            if (!a.node_id && b.node_id) return 1;
            if (a.stack_pattern && !b.stack_pattern) return -1;
            if (!a.stack_pattern && b.stack_pattern) return 1;
            return 0;
        });
        return scoped[0];
    }

    // --- Stack Labels ---

    public getLabels(nodeId: number): Label[] {
        return this.db.prepare('SELECT * FROM stack_labels WHERE node_id = ? ORDER BY name').all(nodeId) as Label[];
    }

    public getLabel(id: number, nodeId: number): Label | null {
        return (this.db.prepare('SELECT * FROM stack_labels WHERE id = ? AND node_id = ?')
            .get(id, nodeId) as Label) ?? null;
    }

    public getLabelCount(nodeId: number): number {
        const row = this.db.prepare('SELECT COUNT(*) as cnt FROM stack_labels WHERE node_id = ?')
            .get(nodeId) as { cnt: number };
        return row.cnt;
    }

    public createLabel(nodeId: number, name: string, color: string): Label {
        const result = this.db.prepare(
            'INSERT INTO stack_labels (node_id, name, color) VALUES (?, ?, ?)'
        ).run(nodeId, name, color);
        return { id: result.lastInsertRowid as number, node_id: nodeId, name, color };
    }

    public updateLabel(id: number, nodeId: number, updates: { name?: string; color?: string }): Label | null {
        const label = this.db.prepare('SELECT * FROM stack_labels WHERE id = ? AND node_id = ?').get(id, nodeId) as Label | undefined;
        if (!label) return null;
        const name = updates.name ?? label.name;
        const color = updates.color ?? label.color;
        this.db.prepare('UPDATE stack_labels SET name = ?, color = ? WHERE id = ? AND node_id = ?').run(name, color, id, nodeId);
        return { ...label, name, color };
    }

    public deleteLabel(id: number, nodeId: number): void {
        this.db.prepare('DELETE FROM stack_labels WHERE id = ? AND node_id = ?').run(id, nodeId);
    }

    public setStackLabels(stackName: string, nodeId: number, labelIds: number[]): void {
        const txn = this.db.transaction(() => {
            if (labelIds.length > 0) {
                const placeholders = labelIds.map(() => '?').join(',');
                const validCount = this.db.prepare(
                    `SELECT COUNT(*) as cnt FROM stack_labels WHERE id IN (${placeholders}) AND node_id = ?`
                ).get(...labelIds, nodeId) as { cnt: number };
                if (validCount.cnt !== labelIds.length) {
                    throw new Error('One or more label IDs are invalid for this node');
                }
            }
            this.db.prepare('DELETE FROM stack_label_assignments WHERE stack_name = ? AND node_id = ?').run(stackName, nodeId);
            const insert = this.db.prepare('INSERT INTO stack_label_assignments (label_id, stack_name, node_id) VALUES (?, ?, ?)');
            for (const labelId of labelIds) {
                insert.run(labelId, stackName, nodeId);
            }
        });
        txn();
    }

    public getLabelsForStacks(nodeId: number): Record<string, Label[]> {
        const rows = this.db.prepare(`
            SELECT a.stack_name, l.id, l.node_id, l.name, l.color
            FROM stack_label_assignments a
            JOIN stack_labels l ON a.label_id = l.id
            WHERE a.node_id = ?
            ORDER BY l.name
        `).all(nodeId) as (Label & { stack_name: string })[];
        const result: Record<string, Label[]> = {};
        for (const row of rows) {
            if (!result[row.stack_name]) result[row.stack_name] = [];
            result[row.stack_name].push({ id: row.id, node_id: row.node_id, name: row.name, color: row.color });
        }
        return result;
    }

    public getStacksForLabel(labelId: number, nodeId: number): string[] {
        const rows = this.db.prepare('SELECT stack_name FROM stack_label_assignments WHERE label_id = ? AND node_id = ?')
            .all(labelId, nodeId) as { stack_name: string }[];
        return rows.map(r => r.stack_name);
    }

    public cleanupStaleAssignments(nodeId: number, validStackNames: string[]): number {
        if (validStackNames.length === 0) {
            const result = this.db.prepare('DELETE FROM stack_label_assignments WHERE node_id = ?').run(nodeId);
            return result.changes;
        }
        const placeholders = validStackNames.map(() => '?').join(',');
        const result = this.db.prepare(
            `DELETE FROM stack_label_assignments WHERE node_id = ? AND stack_name NOT IN (${placeholders})`
        ).run(nodeId, ...validStackNames);
        return result.changes;
    }
}
