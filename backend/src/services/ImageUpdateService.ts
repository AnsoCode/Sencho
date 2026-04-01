import https from 'https';
import http from 'http';
import path from 'path';
import DockerController from './DockerController';
import { DatabaseService } from './DatabaseService';
import { RegistryService } from './RegistryService';
import { NodeRegistry } from './NodeRegistry';

// ─── Image ref parsing ────────────────────────────────────────────────────────

interface ParsedRef {
    registry: string; // e.g. "registry-1.docker.io", "lscr.io", "ghcr.io"
    repo: string;     // e.g. "library/nginx", "linuxserver/sonarr"
    tag: string;      // e.g. "latest", "1.25"
}

function parseImageRef(imageRef: string): ParsedRef | null {
    if (imageRef.startsWith('sha256:')) return null;

    // Strip digest pin (e.g. "nginx@sha256:abc" → "nginx")
    const atIdx = imageRef.indexOf('@');
    if (atIdx !== -1) imageRef = imageRef.slice(0, atIdx);

    let registry = 'registry-1.docker.io';
    let rest = imageRef;

    const slashIdx = imageRef.indexOf('/');
    if (slashIdx !== -1) {
        const firstPart = imageRef.slice(0, slashIdx);
        if (firstPart.includes('.') || firstPart.includes(':') || firstPart === 'localhost') {
            registry = firstPart;
            rest = imageRef.slice(slashIdx + 1);
        }
    }

    // Extract tag
    let tag = 'latest';
    const colonIdx = rest.lastIndexOf(':');
    if (colonIdx > 0) {
        tag = rest.slice(colonIdx + 1);
        rest = rest.slice(0, colonIdx);
    }

    // Docker Hub official images (no slash) → prepend "library/"
    if (registry === 'registry-1.docker.io' && !rest.includes('/')) {
        rest = `library/${rest}`;
    }

    return { registry, repo: rest, tag };
}

// ─── Minimal HTTP helper ──────────────────────────────────────────────────────

interface HttpResult {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

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

// ─── Registry auth ────────────────────────────────────────────────────────────

async function getAuthToken(
    registry: string,
    repo: string,
    credentials?: { username: string; password: string } | null
): Promise<string | null> {
    try {
        const basicHeaders: Record<string, string> = {};
        if (credentials) {
            basicHeaders['Authorization'] = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
        }

        let tokenUrl: string;

        if (registry === 'registry-1.docker.io') {
            tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`;
        } else {
            // Ping /v2/ to get the WWW-Authenticate challenge
            const ping = await httpGet(`https://${registry}/v2/`, basicHeaders);
            const wwwAuth = ping.headers['www-authenticate'] as string | undefined;
            if (!wwwAuth) return null;

            const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
            const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
            const scopeMatch = wwwAuth.match(/scope="([^"]+)"/);
            if (!realmMatch) return null;

            const params = new URLSearchParams();
            if (serviceMatch) params.set('service', serviceMatch[1]);
            params.set('scope', scopeMatch ? scopeMatch[1] : `repository:${repo}:pull`);
            tokenUrl = `${realmMatch[1]}?${params.toString()}`;
        }

        const tokenRes = await httpGet(tokenUrl, basicHeaders);
        if (tokenRes.statusCode !== 200) return null;

        const parsed = JSON.parse(tokenRes.body);
        return parsed.token ?? parsed.access_token ?? null;
    } catch {
        return null;
    }
}

// ─── Remote digest lookup ─────────────────────────────────────────────────────

// Include manifest list types so we get the fat-manifest digest for multi-arch
// images - this matches what Docker stores in local RepoDigests.
const MANIFEST_ACCEPT = [
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.oci.image.manifest.v1+json',
].join(', ');

async function getRemoteDigest(
    registry: string,
    repo: string,
    tag: string,
    credentials?: { username: string; password: string } | null
): Promise<string | null> {
    try {
        const token = await getAuthToken(registry, repo, credentials);
        const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await httpGet(`https://${registry}/v2/${repo}/manifests/${tag}`, headers);
        if (res.statusCode !== 200) return null;

        return (res.headers['docker-content-digest'] as string) ?? null;
    } catch {
        return null;
    }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ImageUpdateService {
    private static instance: ImageUpdateService;
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning = false;
    private lastManualRefreshAt = 0;

    private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000;    // 6 hours
    private static readonly STARTUP_DELAY_MS = 2 * 60 * 1000;    // 2 min after boot
    private static readonly MANUAL_COOLDOWN_MS = 10 * 60 * 1000; // 10 min between manual triggers
    private static readonly INTER_IMAGE_DELAY_MS = 300;           // be polite to registries

    private constructor() { }

    public static getInstance(): ImageUpdateService {
        if (!ImageUpdateService.instance) {
            ImageUpdateService.instance = new ImageUpdateService();
        }
        return ImageUpdateService.instance;
    }

    public start() {
        if (this.intervalId) return;
        setTimeout(() => this.check(), ImageUpdateService.STARTUP_DELAY_MS);
        this.intervalId = setInterval(() => this.check(), ImageUpdateService.INTERVAL_MS);
    }

    public stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Triggers a check immediately, unless one is already running or the
     * 10-minute manual cooldown has not elapsed.
     * Returns false if rate-limited, true if a check was started.
     */
    public triggerManualRefresh(): boolean {
        const now = Date.now();
        if (now - this.lastManualRefreshAt < ImageUpdateService.MANUAL_COOLDOWN_MS) {
            return false;
        }
        this.lastManualRefreshAt = now;
        this.check().catch(e => console.error('[ImageUpdateService] Manual refresh error:', e));
        return true;
    }

    public isChecking(): boolean {
        return this.isRunning;
    }

    // ─── Core check ──────────────────────────────────────────────────────────

    private async check() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('[ImageUpdateService] Starting image update check...');

        try {
            const db = DatabaseService.getInstance();
            // Only check local nodes - remote nodes run their own instance
            for (const node of db.getNodes()) {
                if (node.type !== 'local' || !node.id) continue;
                try {
                    await this.checkNode(node.id, db);
                } catch (e) {
                    console.error(`[ImageUpdateService] Error on node ${node.name}:`, e);
                }
            }
            console.log('[ImageUpdateService] Image update check complete.');
        } catch (e) {
            console.error('[ImageUpdateService] Check failed:', e);
        } finally {
            this.isRunning = false;
        }
    }

    private async checkNode(nodeId: number, db: DatabaseService) {
        const docker = DockerController.getInstance(nodeId);
        const containers = await docker.getAllContainers();
        const composeDir = path.resolve(NodeRegistry.getInstance().getComposeDir(nodeId));

        // stackName → set of image refs used by that stack
        // Key by directory name (matching FileSystemService.getStacks()) rather than
        // com.docker.compose.project label, which diverges when compose files set `name:`.
        const stackImages = new Map<string, Set<string>>();

        for (const c of containers) {
            const workingDir: string | undefined = c.Labels?.['com.docker.compose.project.working_dir'];
            if (!workingDir) continue;

            // Only consider containers managed under COMPOSE_DIR
            const resolved = path.resolve(workingDir);
            if (resolved !== composeDir && !resolved.startsWith(composeDir + path.sep)) continue;

            const stackName = path.basename(resolved);
            const imageRef: string = c.Image ?? '';
            if (!imageRef || imageRef.startsWith('sha256:')) continue;

            if (!stackImages.has(stackName)) stackImages.set(stackName, new Set());
            stackImages.get(stackName)!.add(imageRef);
        }

        if (stackImages.size === 0) return;

        // Deduplicate: each unique image is checked once regardless of how many stacks use it
        const allImages = new Set<string>();
        for (const imgs of stackImages.values()) for (const img of imgs) allImages.add(img);

        const imageUpdateMap = new Map<string, boolean>();

        for (const imageRef of allImages) {
            try {
                imageUpdateMap.set(imageRef, await this.checkImage(docker, imageRef));
            } catch (e) {
                console.error(`[ImageUpdateService] Error checking ${imageRef}:`, e);
                imageUpdateMap.set(imageRef, false);
            }
            await sleep(ImageUpdateService.INTER_IMAGE_DELAY_MS);
        }

        const now = Date.now();
        for (const [stackName, images] of stackImages) {
            const hasUpdate = Array.from(images).some(img => imageUpdateMap.get(img) === true);
            db.upsertStackUpdateStatus(stackName, hasUpdate, now);
        }
    }

    public async checkImage(docker: DockerController, imageRef: string): Promise<boolean> {
        const parsed = parseImageRef(imageRef);
        if (!parsed) return false;

        // Look up stored credentials for this registry
        const credentials = await RegistryService.getInstance().getAuthForRegistry(parsed.registry);

        // Get local digest from RepoDigests
        let localDigest: string | null = null;
        try {
            const inspect = await docker.getDocker().getImage(imageRef).inspect();
            const repoDigests: string[] = inspect.RepoDigests ?? [];

            for (const rd of repoDigests) {
                if (!rd.includes('@sha256:')) continue;
                const [, digest] = rd.split('@');

                // Match: rd contains the repo path or this is the only digest entry
                if (rd.includes(parsed.repo) || rd.includes(parsed.registry) || repoDigests.length === 1) {
                    localDigest = digest;
                    break;
                }
            }
        } catch {
            return false; // Image inspect failed (removed since container was started)
        }

        if (!localDigest) return false; // Locally built or never pulled with a digest

        const remoteDigest = await getRemoteDigest(parsed.registry, parsed.repo, parsed.tag, credentials);
        if (!remoteDigest) return false; // Registry unreachable - no false positives

        const hasUpdate = localDigest !== remoteDigest;
        console.log(
            `[ImageUpdateService] ${imageRef}: ` +
            `local=${localDigest.slice(0, 27)}... remote=${remoteDigest.slice(0, 27)}... update=${hasUpdate}`
        );
        return hasUpdate;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
