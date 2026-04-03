import { DatabaseService, NotificationHistory } from './DatabaseService';

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
        if (stackName) {
            const routes = this.dbService.getEnabledNotificationRoutes();
            const matched = routes.filter(r => r.stack_patterns.includes(stackName));
            if (matched.length > 0) {
                await Promise.allSettled(
                    matched.map(route =>
                        this.sendToChannel(route.channel_type, route.channel_url, level, message)
                            .catch(error => console.error(`Failed to dispatch notification via route "${route.name}":`, error))
                    )
                );
                return;
            }
        }

        // 4. Fall back to global agents
        const agents = this.dbService.getEnabledAgents();
        if (agents.length === 0) {
            console.log('No active notification agents found. Skipping external dispatch.');
            return;
        }

        await Promise.allSettled(
            agents.map(agent =>
                this.sendToChannel(agent.type, agent.url, level, message)
                    .catch(error => console.error(`Failed to dispatch notification to ${agent.type}:`, error))
            )
        );
    }

    private async sendToChannel(type: string, url: string, level: 'info' | 'warning' | 'error', message: string): Promise<void> {
        if (type === 'discord') {
            await this.sendDiscordWebhook(url, level, message);
        } else if (type === 'slack') {
            await this.sendSlackWebhook(url, level, message);
        } else if (type === 'webhook') {
            await this.sendCustomWebhook(url, level, message);
        }
    }

    public async testDispatch(type: 'discord' | 'slack' | 'webhook', url: string) {
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
            body: JSON.stringify(payload)
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
            body: JSON.stringify(payload)
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
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Custom Webhook responded with ${response.status}`);
        }
    }
}
