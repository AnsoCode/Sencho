import https from 'https';
import http from 'http';

export interface ParsedRef {
    registry: string;
    repo: string;
    tag: string;
}

export interface HttpResult {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

export interface RegistryCredentials {
    username: string;
    password: string;
}

export function parseImageRef(imageRef: string): ParsedRef | null {
    if (imageRef.startsWith('sha256:')) return null;

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

    let tag = 'latest';
    const colonIdx = rest.lastIndexOf(':');
    if (colonIdx > 0) {
        tag = rest.slice(colonIdx + 1);
        rest = rest.slice(0, colonIdx);
    }

    if (registry === 'registry-1.docker.io' && !rest.includes('/')) {
        rest = `library/${rest}`;
    }

    return { registry, repo: rest, tag };
}

export function httpGet(
    url: string,
    headers: Record<string, string> = {},
    timeoutMs = 10000,
): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? https : http;
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
        };
        const req = lib.get(url, { headers }, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            res.on('end', () => finish(() => resolve({
                statusCode: res.statusCode ?? 0,
                headers: res.headers as Record<string, string | string[] | undefined>,
                body,
            })));
            res.on('error', (err) => finish(() => reject(err)));
        });
        req.on('error', (err) => finish(() => reject(err)));
        req.setTimeout(timeoutMs, () => {
            const err = new Error('Request timed out');
            req.destroy(err);
            finish(() => reject(err));
        });
    });
}

export async function getAuthToken(
    registry: string,
    repo: string,
    credentials?: RegistryCredentials | null,
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

const MANIFEST_ACCEPT = [
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.oci.image.manifest.v1+json',
].join(', ');

export async function getRemoteDigest(
    registry: string,
    repo: string,
    tag: string,
    credentials?: RegistryCredentials | null,
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

export async function listRegistryTags(
    registry: string,
    repo: string,
    credentials?: RegistryCredentials | null,
): Promise<string[]> {
    try {
        const token = await getAuthToken(registry, repo, credentials);
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await httpGet(`https://${registry}/v2/${repo}/tags/list`, headers);
        if (res.statusCode !== 200) return [];

        const parsed = JSON.parse(res.body) as { tags?: string[] };
        return Array.isArray(parsed.tags) ? parsed.tags : [];
    } catch {
        return [];
    }
}
