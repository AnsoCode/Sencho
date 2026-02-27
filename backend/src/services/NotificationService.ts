import { DatabaseService } from './DatabaseService';

export class NotificationService {
    private static instance: NotificationService;
    private dbService: DatabaseService;

    private constructor() {
        this.dbService = DatabaseService.getInstance();
    }

    public static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    public async dispatchAlert(level: 'info' | 'warning' | 'error', message: string) {
        // 1. Log to history
        this.dbService.addNotificationHistory({
            level,
            message,
            timestamp: Date.now()
        });

        // 2. Fetch enabled agents
        const agents = this.dbService.getEnabledAgents();
        if (agents.length === 0) {
            console.log('No active notification agents found. Skipping external dispatch.');
            return;
        }

        // 3. Dispatch to each agent
        for (const agent of agents) {
            try {
                if (agent.type === 'discord') {
                    await this.sendDiscordWebhook(agent.url, level, message);
                } else if (agent.type === 'slack') {
                    await this.sendSlackWebhook(agent.url, level, message);
                } else if (agent.type === 'webhook') {
                    await this.sendCustomWebhook(agent.url, level, message);
                }
            } catch (error) {
                console.error(`Failed to dispatch notification to ${agent.type}:`, error);
            }
        }
    }

    public async testDispatch(type: 'discord' | 'slack' | 'webhook', url: string) {
        const level = 'info';
        const message = '🔌 Test Notification from Sencho!';

        if (type === 'discord') {
            await this.sendDiscordWebhook(url, level, message);
        } else if (type === 'slack') {
            await this.sendSlackWebhook(url, level, message);
        } else if (type === 'webhook') {
            await this.sendCustomWebhook(url, level, message);
        }
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
