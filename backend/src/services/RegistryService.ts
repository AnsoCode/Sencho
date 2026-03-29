import https from 'https';
import http from 'http';
import { CryptoService } from './CryptoService';
import { DatabaseService, type Registry, type RegistryType } from './DatabaseService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegistryCreateInput {
    name: string;
    url: string;
    type: RegistryType;
    username: string;
    secret: string;
    aws_region?: string | null;
}

export interface RegistryUpdateInput {
    name?: string;
    url?: string;
    type?: RegistryType;
    username?: string;
    secret?: string;
    aws_region?: string | null;
}

interface DockerConfigJson {
    auths: Record<string, { auth: string }>;
}

interface HttpResult {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpGet(url: string, headers: Record<string, string> = {}, timeoutMs = 10000): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? https : http;
        const req = lib.get(url, { headers }, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => resolve({
                statusCode: res.statusCode ?? 0,
                headers: res.headers as Record<string, string | string[] | undefined>,
                body,
            }));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    });
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class RegistryService {
    private static instance: RegistryService;
    private crypto: CryptoService;

    private constructor() {
        this.crypto = CryptoService.getInstance();
    }

    public static getInstance(): RegistryService {
        if (!RegistryService.instance) {
            RegistryService.instance = new RegistryService();
        }
        return RegistryService.instance;
    }

    // ─── CRUD ────────────────────────────────────────────────────────────────

    public getAll(): (Omit<Registry, 'secret'> & { has_secret: boolean })[] {
        const db = DatabaseService.getInstance();
        return db.getRegistries().map(r => {
            const { secret, ...rest } = r;
            return { ...rest, has_secret: !!secret };
        });
    }

    public getById(id: number): (Omit<Registry, 'secret'> & { has_secret: boolean }) | undefined {
        const db = DatabaseService.getInstance();
        const r = db.getRegistry(id);
        if (!r) return undefined;
        const { secret, ...rest } = r;
        return { ...rest, has_secret: !!secret };
    }

    public create(input: RegistryCreateInput): number {
        const db = DatabaseService.getInstance();
        const now = Date.now();
        return db.addRegistry({
            name: input.name,
            url: input.url,
            type: input.type,
            username: input.username,
            secret: this.crypto.encrypt(input.secret),
            aws_region: input.aws_region ?? null,
            created_at: now,
            updated_at: now,
        });
    }

    public update(id: number, input: RegistryUpdateInput): void {
        const db = DatabaseService.getInstance();
        const existing = db.getRegistry(id);
        if (!existing) throw new Error('Registry not found');

        const updates: Partial<Omit<Registry, 'id' | 'created_at'>> = {
            updated_at: Date.now(),
        };

        if (input.name !== undefined) updates.name = input.name;
        if (input.url !== undefined) updates.url = input.url;
        if (input.type !== undefined) updates.type = input.type;
        if (input.username !== undefined) updates.username = input.username;
        if (input.secret !== undefined && input.secret !== '') {
            updates.secret = this.crypto.encrypt(input.secret);
        }
        if (input.aws_region !== undefined) updates.aws_region = input.aws_region;

        db.updateRegistry(id, updates);
    }

    public delete(id: number): void {
        DatabaseService.getInstance().deleteRegistry(id);
    }

    // ─── Test connectivity ───────────────────────────────────────────────────

    public async testConnection(id: number): Promise<{ success: boolean; error?: string }> {
        const db = DatabaseService.getInstance();
        const reg = db.getRegistry(id);
        if (!reg) return { success: false, error: 'Registry not found' };

        try {
            const username = reg.username;
            const password = this.crypto.decrypt(reg.secret);

            if (reg.type === 'ecr') {
                await this.getEcrToken(username, password, reg.aws_region!);
                return { success: true };
            }

            // Standard registry: attempt /v2/ ping with Basic auth
            const registryUrl = this.normalizeRegistryUrl(reg.url);
            const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
            const res = await httpGet(`${registryUrl}/v2/`, { Authorization: `Basic ${basicAuth}` });

            if (res.statusCode === 200 || res.statusCode === 401) {
                // 401 with valid challenge means registry is reachable
                // Try token-based auth if we got 401
                if (res.statusCode === 401) {
                    const wwwAuth = res.headers['www-authenticate'] as string | undefined;
                    if (!wwwAuth) return { success: false, error: 'Registry returned 401 without auth challenge' };

                    const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
                    if (!realmMatch) return { success: false, error: 'Could not parse auth challenge' };

                    const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
                    const params = new URLSearchParams();
                    if (serviceMatch) params.set('service', serviceMatch[1]);
                    const tokenUrl = `${realmMatch[1]}?${params.toString()}`;

                    const tokenRes = await httpGet(tokenUrl, { Authorization: `Basic ${basicAuth}` });
                    if (tokenRes.statusCode !== 200) {
                        return { success: false, error: `Authentication failed (${tokenRes.statusCode})` };
                    }
                }
                return { success: true };
            }

            return { success: false, error: `Registry returned HTTP ${res.statusCode}` };
        } catch (e) {
            return { success: false, error: (e as Error).message };
        }
    }

    // ─── Docker config resolution (for ComposeService) ───────────────────────

    public async resolveDockerConfig(): Promise<DockerConfigJson> {
        const db = DatabaseService.getInstance();
        const registries = db.getRegistries();
        const auths: Record<string, { auth: string }> = {};

        for (const reg of registries) {
            try {
                const decryptedSecret = this.crypto.decrypt(reg.secret);
                let username = reg.username;
                let password = decryptedSecret;

                if (reg.type === 'ecr') {
                    const ecrCreds = await this.getEcrToken(reg.username, decryptedSecret, reg.aws_region!);
                    username = ecrCreds.username;
                    password = ecrCreds.password;
                }

                const auth = Buffer.from(`${username}:${password}`).toString('base64');
                auths[reg.url] = { auth };
            } catch (e) {
                console.error(`[RegistryService] Failed to resolve credentials for ${reg.name}:`, e);
            }
        }

        return { auths };
    }

    // ─── Registry auth for ImageUpdateService ────────────────────────────────

    public async getAuthForRegistry(registryHost: string): Promise<{ username: string; password: string } | null> {
        const db = DatabaseService.getInstance();
        const registries = db.getRegistries();

        // Match by URL containing the registry host
        const match = registries.find(r => {
            const normalizedUrl = r.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
            return normalizedUrl === registryHost || normalizedUrl.includes(registryHost) || registryHost.includes(normalizedUrl);
        });

        if (!match) return null;

        try {
            const decryptedSecret = this.crypto.decrypt(match.secret);

            if (match.type === 'ecr') {
                return await this.getEcrToken(match.username, decryptedSecret, match.aws_region!);
            }

            return { username: match.username, password: decryptedSecret };
        } catch (e) {
            console.error(`[RegistryService] Failed to resolve auth for ${registryHost}:`, e);
            return null;
        }
    }

    // ─── ECR token fetch ─────────────────────────────────────────────────────

    private async getEcrToken(accessKeyId: string, secretAccessKey: string, region: string): Promise<{ username: string; password: string }> {
        const { ECRClient, GetAuthorizationTokenCommand } = await import('@aws-sdk/client-ecr');
        const client = new ECRClient({
            region,
            credentials: { accessKeyId, secretAccessKey },
        });
        const response = await client.send(new GetAuthorizationTokenCommand({}));
        const authData = response.authorizationData?.[0];
        if (!authData?.authorizationToken) throw new Error('ECR returned no authorization token');

        const decoded = Buffer.from(authData.authorizationToken, 'base64').toString();
        const [username, ...passwordParts] = decoded.split(':');
        return { username, password: passwordParts.join(':') };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private normalizeRegistryUrl(url: string): string {
        // Ensure URL has a protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `https://${url}`;
        }
        return url.replace(/\/$/, '');
    }
}
