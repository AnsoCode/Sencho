import https from 'https';
import http from 'http';
import path from 'path';
import YAML from 'yaml';
import DockerController from './DockerController';
import { DatabaseService } from './DatabaseService';
import { FileSystemService } from './FileSystemService';
import { RegistryService } from './RegistryService';
import { NodeRegistry } from './NodeRegistry';
import { isDebugEnabled } from '../utils/debug';

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

export interface ImageCheckResult {
    hasUpdate: boolean;
    error?: string;
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

// ─── Compose file helpers ────────────────────────────────────────────────────

function loadDotEnv(content: string): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        vars[key] = val;
    }
    return vars;
}

function extractImagesFromCompose(
    yamlContent: string,
    envVars: Record<string, string>
): string[] {
    let parsed: Record<string, unknown>;
    try {
        parsed = YAML.parse(yamlContent) as Record<string, unknown>;
    } catch {
        return [];
    }
    if (!parsed?.services || typeof parsed.services !== 'object') return [];

    const images: string[] = [];
    for (const svc of Object.values(parsed.services as Record<string, unknown>)) {
        if (!svc || typeof svc !== 'object') continue;
        const raw = (svc as Record<string, unknown>).image;
        if (!raw || typeof raw !== 'string') continue;

        let ref = raw.replace(
            /\$\{([^}]+)\}/g,
            (_: string, expr: string) => {
                const defaultMatch = expr.match(/^([^:-]+)(?::?-)(.+)$/);
                if (defaultMatch) {
                    return envVars[defaultMatch[1]] ?? defaultMatch[2];
                }
                return envVars[expr] ?? '';
            }
        );

        ref = ref.trim();
        if (!ref || ref.includes('${') || ref.startsWith('sha256:')) continue;
        images.push(ref);
    }
    return images;
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
    private static readonly MANUAL_COOLDOWN_MS = 2 * 60 * 1000;  // 2 min between manual triggers
    private static readonly INTER_IMAGE_DELAY_MS = 300;           // be polite to registries

    public static get manualCooldownMinutes(): number {
        return ImageUpdateService.MANUAL_COOLDOWN_MS / (60 * 1000);
    }

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
     * manual cooldown (MANUAL_COOLDOWN_MS) has not elapsed.
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
        const fs = FileSystemService.getInstance(nodeId);
        const composeDir = path.resolve(NodeRegistry.getInstance().getComposeDir(nodeId));

        // Phase 1: Filesystem discovery (all stacks with compose files)
        const stacks = await fs.getStacks();
        const stackImages = new Map<string, Set<string>>();
        for (const name of stacks) stackImages.set(name, new Set());

        // Phase 2: Parse compose files for image refs
        for (const stackName of stacks) {
            try {
                const content = await fs.getStackContent(stackName);

                // Load .env for variable resolution (best-effort)
                let envVars: Record<string, string> = {};
                try {
                    const envContent = await fs.getEnvContent(stackName);
                    envVars = loadDotEnv(envContent);
                } catch {
                    // No .env file or unreadable; continue with process.env only
                }
                // Docker Compose precedence: host env overrides .env
                const merged: Record<string, string> = { ...envVars };
                for (const [k, v] of Object.entries(process.env)) {
                    if (v !== undefined) merged[k] = v;
                }

                for (const img of extractImagesFromCompose(content, merged)) {
                    stackImages.get(stackName)?.add(img);
                }
            } catch (e) {
                console.warn(`[ImageUpdateService] Could not parse compose for "${stackName}":`, e);
            }
        }

        // Phase 3: Container augmentation (captures actual deployed image tags)
        try {
            const containers = await docker.getAllContainers();
            for (const c of containers) {
                const workingDir: string | undefined = c.Labels?.['com.docker.compose.project.working_dir'];
                if (!workingDir) continue;

                const resolved = path.resolve(workingDir);
                if (resolved !== composeDir && !resolved.startsWith(composeDir + path.sep)) continue;

                const stackName = path.basename(resolved);
                const imageRef: string = c.Image ?? '';
                if (!imageRef || imageRef.startsWith('sha256:')) continue;

                // Only augment stacks found on the filesystem
                if (stackImages.has(stackName)) {
                    stackImages.get(stackName)?.add(imageRef);
                }
            }
        } catch (e) {
            console.warn('[ImageUpdateService] Container augmentation failed:', e);
        }

        // Phase 4: Deduplicate and check all unique images
        const allImages = new Set<string>();
        for (const imgs of stackImages.values()) for (const img of imgs) allImages.add(img);

        const imageUpdateMap = new Map<string, ImageCheckResult>();

        for (const imageRef of allImages) {
            try {
                imageUpdateMap.set(imageRef, await this.checkImage(docker, imageRef));
            } catch (e) {
                console.error(`[ImageUpdateService] Error checking ${imageRef}:`, e);
                imageUpdateMap.set(imageRef, { hasUpdate: false, error: String(e) });
            }
            await sleep(ImageUpdateService.INTER_IMAGE_DELAY_MS);
        }

        // Write status for ALL stacks (including those with no pullable images)
        const now = Date.now();
        let updatesFound = 0;
        for (const [stackName, images] of stackImages) {
            const hasUpdate = Array.from(images).some(img => imageUpdateMap.get(img)?.hasUpdate === true);
            if (hasUpdate) updatesFound++;
            db.upsertStackUpdateStatus(nodeId, stackName, hasUpdate, now);
        }

        console.log(`[ImageUpdateService] Node ${nodeId}: checked ${allImages.size} image(s), ${updatesFound} stack(s) with updates`);

        // Prune stale entries for stacks no longer on disk
        const existing = db.getStackUpdateStatus(nodeId);
        for (const staleStack of Object.keys(existing)) {
            if (!stackImages.has(staleStack)) {
                db.clearStackUpdateStatus(nodeId, staleStack);
            }
        }
    }

    public async checkImage(docker: DockerController, imageRef: string): Promise<ImageCheckResult> {
        const parsed = parseImageRef(imageRef);
        if (!parsed) return { hasUpdate: false };

        if (isDebugEnabled()) {
            console.log(`[ImageUpdateService] Checking ${imageRef}: registry=${parsed.registry} repo=${parsed.repo} tag=${parsed.tag}`);
        }

        // Look up stored credentials for this registry
        const credentials = await RegistryService.getInstance().getAuthForRegistry(parsed.registry);
        if (isDebugEnabled()) {
            console.log(`[ImageUpdateService] ${imageRef}: credentials ${credentials ? 'found' : 'none'}`);
        }

        // Get local digest from RepoDigests
        let localDigest: string | null = null;
        try {
            const inspect = await docker.getDocker().getImage(imageRef).inspect();
            const repoDigests: string[] = inspect.RepoDigests ?? [];

            for (const rd of repoDigests) {
                if (!rd.includes('@sha256:')) continue;
                const [, digest] = rd.split('@');

                if (rd.includes(parsed.repo) || rd.includes(parsed.registry) || repoDigests.length === 1) {
                    localDigest = digest;
                    break;
                }
            }
        } catch {
            return { hasUpdate: false, error: `Failed to inspect local image "${imageRef}"` };
        }

        if (!localDigest) return { hasUpdate: false };

        const remoteDigest = await getRemoteDigest(parsed.registry, parsed.repo, parsed.tag, credentials);
        if (!remoteDigest) {
            return { hasUpdate: false, error: `Registry unreachable for ${parsed.registry}/${parsed.repo}:${parsed.tag}` };
        }

        const hasUpdate = localDigest !== remoteDigest;
        console.log(
            `[ImageUpdateService] ${imageRef}: ` +
            `local=${localDigest.slice(0, 27)}... remote=${remoteDigest.slice(0, 27)}... update=${hasUpdate}`
        );
        return { hasUpdate };
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
