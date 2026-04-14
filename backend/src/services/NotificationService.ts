import { DatabaseService, NotificationHistory } from './DatabaseService';
import { isDebugEnabled } from '../utils/debug';
import { getErrorMessage } from '../utils/errors';

/** Webhook timeout: 10 seconds per external dispatch call. */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** Valid notification channel types for defense-in-depth validation. */
const ALLOWED_CHANNEL_TYPES = new Set(['discord', 'slack', 'webhook']);

export class NotificationService {
    private static instance: NotificationService;
    private dbService: DatabaseService;
    private broadcaster: ((notification: NotificationHistory) => void) | null = null;

    private constructor() {
        this.dbService = DatabaseService.getInstance();
    }

    public static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    /** Wire up the WebSocket push function after the WS server is initialised. */
    public setBroadcaster(fn: (notification: NotificationHistory) => void): void {
        this.broadcaster = fn;
    }

    /**
     * Dispatch an alert: log to history, push via WebSocket, and route to
     * external channels.
     *
     * Routing uses two tiers that coexist intentionally:
     *  - notification_routes (Admiral tier): per-stack pattern-based routing
     *    with priority ordering. If any route matches, global agents are skipped.
     *  - agents table (all tiers): global fallback channels used when no
     *    notification_routes match or when no stackName is provided.
     */
    public async dispatchAlert(level: 'info' | 'warning' | 'error', message: string, stackName?: string) {
        // 1. Log to history and get the full inserted record (with id)
        const notification = this.dbService.addNotificationHistory({
            level,
            message,
            timestamp: Date.now()
        });

        // 2. Push to connected browser clients via WebSocket
        if (this.broadcaster) {
            this.broadcaster(notification);
        }

        // 3. Check notification routing rules if a stack context is available
        const errors: string[] = [];

        if (stackName) {
            const routes = this.dbService.getEnabledNotificationRoutes();
            const matched = routes.filter(r => r.stack_patterns.includes(stackName));
            if (matched.length > 0) {
                if (isDebugEnabled()) console.log(`[Notify:diag] Matched ${matched.length} route(s) for stack "${stackName}"`);
                await Promise.allSettled(
                    matched.map(route =>
                        this.sendToChannel(route.channel_type, route.channel_url, level, message)
                            .then(() => {
                                if (isDebugEnabled()) console.log(`[Notify:diag] Dispatched ${level} via route "${route.name}" (${route.channel_type})`);
                            })
                            .catch(error => {
                                console.error(`Failed to dispatch notification via route "${route.name}":`, error);
                                errors.push(`Route "${route.name}": ${getErrorMessage(error, String(error))}`);
                            })
                    )
                );
                this.recordDispatchErrors(notification.id!, errors);
                return;
            }
        }

        // 4. Fall back to global agents
        const agents = this.dbService.getEnabledAgents();
        if (agents.length === 0) {
            if (isDebugEnabled()) console.log('[Notify:diag] No routes or agents matched; skipping external dispatch');
            return;
        }

        if (isDebugEnabled()) console.log(`[Notify:diag] Falling back to ${agents.length} global agent(s)`);
        await Promise.allSettled(
            agents.map(agent =>
                this.sendToChannel(agent.type, agent.url, level, message)
                    .then(() => {
                        if (isDebugEnabled()) console.log(`[Notify:diag] Dispatched ${level} via global agent (${agent.type})`);
                    })
                    .catch(error => {
                        console.error(`Failed to dispatch notification to ${agent.type}:`, error);
                        errors.push(`${agent.type}: ${getErrorMessage(error, String(error))}`);
                    })
            )
        );
        this.recordDispatchErrors(notification.id!, errors);
    }

    /** Persist dispatch errors to the notification record for user visibility. */
    private recordDispatchErrors(notificationId: number, errors: string[]) {
        if (errors.length > 0) {
            try {
                this.dbService.updateNotificationDispatchError(notificationId, errors.join('; '));
            } catch (e) {
                console.error('[Notify] Failed to record dispatch error:', e);
            }
        }
    }

    private async sendToChannel(type: string, url: string, level: 'info' | 'warning' | 'error', message: string): Promise<void> {
        if (type === 'discord') {
            await this.sendDiscordWebhook(url, level, message);
        } else if (type === 'slack') {
            await this.sendSlackWebhook(url, level, message);
        } else if (type === 'webhook') {
            await this.sendCustomWebhook(url, level, message);
        } else {
            throw new Error(`Unsupported channel type: ${type}`);
        }
    }

    public async testDispatch(type: 'discord' | 'slack' | 'webhook', url: string) {
        if (!ALLOWED_CHANNEL_TYPES.has(type)) throw new Error(`Invalid notification type: ${type}`);
        if (!url || !url.startsWith('https://')) throw new Error('URL must use HTTPS');
        await this.sendToChannel(type, url, 'info', '🔌 Test Notification from Sencho!');
    }

    private async sendDiscordWebhook(url: string, level: 'info' | 'warning' | 'error', message: string) {
        const colorMap = {
            info: 3447003,    // Blue
            warning: 16776960, // Yellow
            error: 15158332    // Red
        };

        const payload = {
            embeds: [{
                title: `Sencho Alert [${level.toUpperCase()}]`,
                description: message,
                color: colorMap[level],
                timestamp: new Date().toISOString()
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`Discord Webhook responded with ${response.status}`);
        }
    }

    private async sendSlackWebhook(url: string, level: 'info' | 'warning' | 'error', message: string) {
        const emojiMap = {
            info: 'ℹ️',
            warning: '⚠️',
            error: '🚨'
        };

        const payload = {
            text: `${emojiMap[level]} *Sencho Alert [${level.toUpperCase()}]*\n${message}`
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`Slack Webhook responded with ${response.status}`);
        }
    }

    private async sendCustomWebhook(url: string, level: 'info' | 'warning' | 'error', message: string) {
        const payload = {
            level,
            message,
            timestamp: new Date().toISOString(),
            source: 'sencho'
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`Custom Webhook responded with ${response.status}`);
        }
    }
}
