import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import DockerController from './DockerController';
import {
    DatabaseService,
    VulnSeverity,
    VulnScanTrigger,
    VulnerabilityScan,
} from './DatabaseService';
import { RegistryService } from './RegistryService';
import { disableCapability, enableCapability } from './CapabilityRegistry';
import TrivyInstaller, { type TrivySource } from './TrivyInstaller';
import { getErrorMessage } from '../utils/errors';
import { isDebugEnabled } from '../utils/debug';
import { SEVERITY_ORDER } from '../utils/severity';

const execFileAsync = promisify(execFile);

const SCAN_TIMEOUT_MS = 5 * 60 * 1000;
const SBOM_TIMEOUT_MS = 3 * 60 * 1000;
export const DIGEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function diag(msg: string, ...args: unknown[]): void {
    if (isDebugEnabled()) console.log(`[Trivy:diag] ${msg}`, ...args);
}

interface TrivyRawVulnerability {
    VulnerabilityID?: string;
    PkgName?: string;
    InstalledVersion?: string;
    FixedVersion?: string;
    Severity?: string;
    Title?: string;
    Description?: string;
    PrimaryURL?: string;
}

interface TrivyRawResult {
    Target?: string;
    Vulnerabilities?: TrivyRawVulnerability[];
}

interface TrivyRawOutput {
    Metadata?: {
        OS?: { Family?: string; Name?: string };
        ImageID?: string;
        RepoDigests?: string[];
    };
    Results?: TrivyRawResult[];
}

export interface TrivyVulnerability {
    vulnerabilityId: string;
    pkgName: string;
    installedVersion: string;
    fixedVersion: string | null;
    severity: VulnSeverity;
    title: string;
    description: string;
    primaryUrl: string | null;
}

export interface TrivyScanResult {
    imageRef: string;
    imageDigest: string | null;
    scannedAt: number;
    totalVulnerabilities: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    unknownCount: number;
    fixableCount: number;
    highestSeverity: VulnSeverity | null;
    vulnerabilities: TrivyVulnerability[];
    metadata: {
        os: string | null;
        trivyVersion: string | null;
        scanDurationMs: number;
    };
}

export type SbomFormat = 'spdx-json' | 'cyclonedx';

function normalizeSeverity(raw: string | undefined): VulnSeverity {
    const s = (raw ?? '').toUpperCase();
    if (s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW') return s;
    return 'UNKNOWN';
}

function computeHighestSeverity(vulns: TrivyVulnerability[]): VulnSeverity | null {
    if (vulns.length === 0) return null;
    let highestIdx = -1;
    for (const v of vulns) {
        const idx = SEVERITY_ORDER.indexOf(v.severity);
        if (idx > highestIdx) highestIdx = idx;
    }
    return highestIdx >= 0 ? SEVERITY_ORDER[highestIdx] : null;
}

export function parseTrivyOutput(raw: string): {
    vulnerabilities: TrivyVulnerability[];
    os: string | null;
} {
    let parsed: TrivyRawOutput;
    try {
        parsed = JSON.parse(raw) as TrivyRawOutput;
    } catch (e) {
        console.error('[Trivy] Failed to parse output; first 200 chars:', raw.slice(0, 200));
        throw new Error('Malformed Trivy output: ' + (e as Error).message);
    }
    const seen = new Set<string>();
    const vulnerabilities: TrivyVulnerability[] = [];
    for (const result of parsed.Results ?? []) {
        for (const v of result.Vulnerabilities ?? []) {
            const id = v.VulnerabilityID ?? '';
            const pkg = v.PkgName ?? '';
            if (!id || !pkg) continue;
            const key = `${id}::${pkg}`;
            if (seen.has(key)) continue;
            seen.add(key);
            vulnerabilities.push({
                vulnerabilityId: id,
                pkgName: pkg,
                installedVersion: v.InstalledVersion ?? '',
                fixedVersion: v.FixedVersion ? v.FixedVersion : null,
                severity: normalizeSeverity(v.Severity),
                title: v.Title ?? '',
                description: v.Description ?? '',
                primaryUrl: v.PrimaryURL ? v.PrimaryURL : null,
            });
        }
    }
    const osFamily = parsed.Metadata?.OS?.Family;
    const osName = parsed.Metadata?.OS?.Name;
    const osInfo = osFamily
        ? osName
            ? `${osFamily} ${osName}`
            : osFamily
        : null;
    return { vulnerabilities, os: osInfo };
}

class TrivyService {
    private static instance: TrivyService;
    private version: string | null = null;
    private binaryPath: string | null = null;
    private source: TrivySource = 'none';
    private scanningImages: Set<string> = new Set();
    private cacheDirEnsured: string | null = null;
    private detectionTimestamp = 0;

    public static getInstance(): TrivyService {
        if (!TrivyService.instance) {
            TrivyService.instance = new TrivyService();
        }
        return TrivyService.instance;
    }

    async initialize(): Promise<void> {
        await this.detectTrivy();
        if (this.source === 'none') {
            console.log('[Trivy] Binary not found; vulnerability scanning disabled');
        } else {
            console.log(`[Trivy] Available (version ${this.version}, source ${this.source})`);
        }
    }

    async detectTrivy(): Promise<{ available: boolean; version: string | null; source: TrivySource }> {
        const started = Date.now();
        const wasAvailable = this.source !== 'none';
        const candidates: Array<{ path: string; source: TrivySource }> = [];
        const managedPath = TrivyInstaller.getInstance().binaryPath();
        try {
            fs.accessSync(managedPath, fs.constants.X_OK);
            candidates.push({ path: managedPath, source: 'managed' });
        } catch {
            /* not installed */
        }
        const envOverride = process.env.TRIVY_BIN;
        if (envOverride) {
            candidates.push({ path: envOverride, source: 'host' });
        }
        candidates.push({ path: 'trivy', source: 'host' });

        let detected = false;
        for (const candidate of candidates) {
            try {
                const { stdout } = await execFileAsync(candidate.path, ['--version'], { timeout: 5000 });
                const match = stdout.match(/Version:\s*([^\s\n]+)/i);
                this.version = match ? match[1] : stdout.split('\n')[0]?.trim() || 'unknown';
                this.binaryPath = candidate.path;
                this.source = candidate.source;
                detected = true;
                break;
            } catch {
                /* try next */
            }
        }
        if (!detected) {
            this.version = null;
            this.binaryPath = null;
            this.source = 'none';
        }
        this.detectionTimestamp = Date.now();
        const isAvailable = this.source !== 'none';
        diag(
            `detectTrivy: available=${isAvailable} source=${this.source} version=${this.version ?? 'null'} tookMs=${
                this.detectionTimestamp - started
            }`,
        );
        if (isAvailable && !wasAvailable) {
            enableCapability('vulnerability-scanning');
            console.log(
                `[Trivy] Binary detected (source=${this.source}); vulnerability scanning enabled (version ${this.version})`,
            );
        } else if (!isAvailable && wasAvailable) {
            disableCapability('vulnerability-scanning');
            console.warn('[Trivy] Binary no longer detected; vulnerability scanning disabled');
        }
        return { available: isAvailable, version: this.version, source: this.source };
    }

    getDetectionTimestamp(): number {
        return this.detectionTimestamp;
    }

    isTrivyAvailable(): boolean {
        return this.source !== 'none';
    }

    getVersion(): string | null {
        return this.version;
    }

    getSource(): TrivySource {
        return this.source;
    }

    private ensureCacheDir(): string {
        const cacheDir = process.env.TRIVY_CACHE_DIR || TrivyInstaller.getInstance().cacheDir();
        if (this.cacheDirEnsured !== cacheDir) {
            try {
                fs.mkdirSync(cacheDir, { recursive: true });
            } catch {
                /* best-effort; Trivy will surface a clearer error on scan */
            }
            this.cacheDirEnsured = cacheDir;
        }
        return cacheDir;
    }

    private async buildEnv(
        sendWarning?: (msg: string) => void,
    ): Promise<{ env: Record<string, string | undefined>; cleanup: () => void }> {
        const registries = DatabaseService.getInstance().getRegistries();
        const cacheDir = this.ensureCacheDir();
        const baseEnv: Record<string, string | undefined> = {
            ...process.env,
            TRIVY_CACHE_DIR: cacheDir,
            PATH:
                process.env.PATH ||
                '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        };
        if (registries.length === 0) {
            return { env: baseEnv, cleanup: () => undefined };
        }
        const { config, warnings } = await RegistryService.getInstance().resolveDockerConfig();
        if (sendWarning) {
            for (const w of warnings) sendWarning(w);
        }
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sencho-trivy-'));
        const configPath = path.join(tmpDir, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
        const cleanup = () => {
            try {
                fs.unlinkSync(configPath);
            } catch {
                /* noop */
            }
            try {
                fs.rmdirSync(tmpDir);
            } catch {
                /* noop */
            }
        };
        return { env: { ...baseEnv, DOCKER_CONFIG: tmpDir }, cleanup };
    }

    async getImageDigest(imageRef: string, nodeId: number): Promise<string | null> {
        try {
            const docker = DockerController.getInstance(nodeId).getDocker();
            const info = (await docker.getImage(imageRef).inspect()) as {
                RepoDigests?: string[];
                Id?: string;
            };
            if (info.RepoDigests && info.RepoDigests.length > 0) {
                const digest = info.RepoDigests[0].split('@')[1];
                if (digest) return digest;
            }
            return info.Id ?? null;
        } catch {
            return null;
        }
    }

    private scanKey(nodeId: number, imageRef: string): string {
        return `${nodeId}:${imageRef}`;
    }

    isScanning(nodeId: number, imageRef: string): boolean {
        return this.scanningImages.has(this.scanKey(nodeId, imageRef));
    }

    async scanImage(
        imageRef: string,
        nodeId: number,
        options: { useCache?: boolean; digest?: string | null } = {},
    ): Promise<TrivyScanResult> {
        const binary = this.binaryPath;
        if (!binary) {
            throw new Error('Trivy is not available on this host');
        }
        const key = this.scanKey(nodeId, imageRef);
        if (this.scanningImages.has(key)) {
            throw new Error('Already scanning this image');
        }
        this.scanningImages.add(key);
        const startedAt = Date.now();
        diag(`scanImage: start nodeId=${nodeId} imageRef=${imageRef} useCache=${options.useCache !== false}`);

        try {
            const digest = options.digest ?? (await this.getImageDigest(imageRef, nodeId));
            diag(`scanImage: digest=${digest ?? 'null'} for ${imageRef}`);

            if (options.useCache !== false && digest) {
                const cached = DatabaseService.getInstance().getLatestScanByDigest(digest);
                if (cached && startedAt - cached.scanned_at < DIGEST_CACHE_TTL_MS) {
                    diag(
                        `scanImage: cache hit for digest=${digest} scanId=${cached.id} ageMs=${startedAt - cached.scanned_at}`,
                    );
                    const details =
                        DatabaseService.getInstance().getVulnerabilityDetails(cached.id, {
                            limit: 1000,
                        }).items;
                    return {
                        imageRef,
                        imageDigest: digest,
                        scannedAt: cached.scanned_at,
                        totalVulnerabilities: cached.total_vulnerabilities,
                        criticalCount: cached.critical_count,
                        highCount: cached.high_count,
                        mediumCount: cached.medium_count,
                        lowCount: cached.low_count,
                        unknownCount: cached.unknown_count,
                        fixableCount: cached.fixable_count,
                        highestSeverity: cached.highest_severity,
                        vulnerabilities: details.map((d) => ({
                            vulnerabilityId: d.vulnerability_id,
                            pkgName: d.pkg_name,
                            installedVersion: d.installed_version,
                            fixedVersion: d.fixed_version,
                            severity: d.severity,
                            title: d.title ?? '',
                            description: d.description ?? '',
                            primaryUrl: d.primary_url,
                        })),
                        metadata: {
                            os: cached.os_info,
                            trivyVersion: cached.trivy_version,
                            scanDurationMs: cached.scan_duration_ms ?? 0,
                        },
                    };
                }
            }

            diag(`scanImage: cache miss; invoking trivy for ${imageRef}`);
            const { env, cleanup } = await this.buildEnv();
            try {
                const args = [
                    'image',
                    '--format',
                    'json',
                    '--quiet',
                    '--no-progress',
                    '--scanners',
                    'vuln',
                    imageRef,
                ];
                const execStart = Date.now();
                const { stdout } = await execFileAsync(binary, args, {
                    env,
                    timeout: SCAN_TIMEOUT_MS,
                    maxBuffer: 64 * 1024 * 1024,
                });
                diag(
                    `scanImage: trivy exited after ${Date.now() - execStart}ms, output=${stdout.length} bytes`,
                );
                const { vulnerabilities, os: osInfo } = parseTrivyOutput(stdout);
                diag(
                    `scanImage: parsed ${vulnerabilities.length} unique vulns (os=${osInfo ?? 'unknown'})`,
                );

                let critical = 0,
                    high = 0,
                    medium = 0,
                    low = 0,
                    unknown = 0,
                    fixable = 0;
                for (const v of vulnerabilities) {
                    switch (v.severity) {
                        case 'CRITICAL':
                            critical++;
                            break;
                        case 'HIGH':
                            high++;
                            break;
                        case 'MEDIUM':
                            medium++;
                            break;
                        case 'LOW':
                            low++;
                            break;
                        default:
                            unknown++;
                    }
                    if (v.fixedVersion) fixable++;
                }

                return {
                    imageRef,
                    imageDigest: digest,
                    scannedAt: Date.now(),
                    totalVulnerabilities: vulnerabilities.length,
                    criticalCount: critical,
                    highCount: high,
                    mediumCount: medium,
                    lowCount: low,
                    unknownCount: unknown,
                    fixableCount: fixable,
                    highestSeverity: computeHighestSeverity(vulnerabilities),
                    vulnerabilities,
                    metadata: {
                        os: osInfo,
                        trivyVersion: this.version,
                        scanDurationMs: Date.now() - startedAt,
                    },
                };
            } finally {
                cleanup();
            }
        } finally {
            this.scanningImages.delete(key);
        }
    }

    /**
     * Create an `in_progress` scan row. The returned ID is immediately
     * usable by clients that need a handle to poll; callers must pair
     * this with `finishScan` to move the row to `completed` or `failed`.
     */
    beginScan(
        imageRef: string,
        nodeId: number,
        triggeredBy: VulnScanTrigger,
        stackContext: string | null = null,
    ): number {
        const db = DatabaseService.getInstance();
        const scanId = db.createVulnerabilityScan({
            node_id: nodeId,
            image_ref: imageRef,
            image_digest: null,
            scanned_at: Date.now(),
            total_vulnerabilities: 0,
            critical_count: 0,
            high_count: 0,
            medium_count: 0,
            low_count: 0,
            unknown_count: 0,
            fixable_count: 0,
            highest_severity: null,
            os_info: null,
            trivy_version: this.version,
            scan_duration_ms: null,
            triggered_by: triggeredBy,
            status: 'in_progress',
            error: null,
            stack_context: stackContext,
        });
        diag(`beginScan: scanId=${scanId} imageRef=${imageRef} nodeId=${nodeId} trigger=${triggeredBy}`);
        return scanId;
    }

    /**
     * Execute the scan and persist results into a scan row already
     * created by `beginScan`. Always flips the row to `completed` on
     * success or `failed` on error.
     */
    async finishScan(
        scanId: number,
        imageRef: string,
        nodeId: number,
        opts: { useCache?: boolean } = {},
    ): Promise<VulnerabilityScan> {
        const db = DatabaseService.getInstance();
        const startedAt = Date.now();
        try {
            const result = await this.scanImage(imageRef, nodeId, { useCache: opts.useCache });
            db.updateVulnerabilityScan(scanId, {
                image_digest: result.imageDigest,
                scanned_at: result.scannedAt,
                total_vulnerabilities: result.totalVulnerabilities,
                critical_count: result.criticalCount,
                high_count: result.highCount,
                medium_count: result.mediumCount,
                low_count: result.lowCount,
                unknown_count: result.unknownCount,
                fixable_count: result.fixableCount,
                highest_severity: result.highestSeverity,
                os_info: result.metadata.os,
                trivy_version: result.metadata.trivyVersion,
                scan_duration_ms: result.metadata.scanDurationMs,
                status: 'completed',
            });
            db.insertVulnerabilityDetails(
                scanId,
                result.vulnerabilities.map((v) => ({
                    vulnerability_id: v.vulnerabilityId,
                    pkg_name: v.pkgName,
                    installed_version: v.installedVersion,
                    fixed_version: v.fixedVersion,
                    severity: v.severity,
                    title: v.title || null,
                    description: v.description || null,
                    primary_url: v.primaryUrl,
                })),
            );
            const stored = db.getVulnerabilityScan(scanId);
            if (!stored) throw new Error('Scan vanished after write');
            diag(
                `finishScan: scanId=${scanId} completed total=${result.totalVulnerabilities} highest=${result.highestSeverity ?? 'none'} durationMs=${result.metadata.scanDurationMs}`,
            );
            return stored;
        } catch (error) {
            const msg = getErrorMessage(error, 'Scan failed');
            db.updateVulnerabilityScan(scanId, {
                status: 'failed',
                error: msg,
                scan_duration_ms: Date.now() - startedAt,
            });
            diag(`finishScan: scanId=${scanId} failed: ${msg}`);
            throw error;
        }
    }

    async runScanAndPersist(
        imageRef: string,
        nodeId: number,
        triggeredBy: VulnScanTrigger,
        stackContext: string | null = null,
        opts: { useCache?: boolean } = {},
    ): Promise<VulnerabilityScan> {
        const scanId = this.beginScan(imageRef, nodeId, triggeredBy, stackContext);
        return this.finishScan(scanId, imageRef, nodeId, opts);
    }

    async scanAllNodeImages(
        nodeId: number,
        triggeredBy: VulnScanTrigger = 'scheduled',
    ): Promise<{ scanned: number; skipped: number; failed: number }> {
        if (this.source === 'none') {
            throw new Error('Trivy is not available on this host');
        }
        const images = await DockerController.getInstance(nodeId).getImages();
        const imageRefs = new Set<string>();
        for (const img of images as Array<{ RepoTags?: string[] }>) {
            for (const tag of img.RepoTags ?? []) {
                if (tag && tag !== '<none>:<none>') imageRefs.add(tag);
            }
        }

        let scanned = 0;
        let skipped = 0;
        let failed = 0;
        for (const ref of imageRefs) {
            try {
                const digest = await this.getImageDigest(ref, nodeId);
                if (digest) {
                    const cached =
                        DatabaseService.getInstance().getLatestScanByDigest(digest);
                    if (cached && Date.now() - cached.scanned_at < DIGEST_CACHE_TTL_MS) {
                        skipped++;
                        continue;
                    }
                }
                await this.runScanAndPersist(ref, nodeId, triggeredBy, null);
                scanned++;
            } catch (err) {
                failed++;
                console.warn(`[Trivy] Failed to scan ${ref}:`, getErrorMessage(err, 'unknown error'));
            }
            await new Promise((r) => setTimeout(r, 300));
        }
        return { scanned, skipped, failed };
    }

    async generateSBOM(imageRef: string, format: SbomFormat): Promise<string> {
        const binary = this.binaryPath;
        if (!binary) {
            throw new Error('Trivy is not available on this host');
        }
        const { env, cleanup } = await this.buildEnv();
        try {
            const { stdout } = await execFileAsync(
                binary,
                ['image', '--format', format, '--quiet', '--no-progress', imageRef],
                {
                    env,
                    timeout: SBOM_TIMEOUT_MS,
                    maxBuffer: 64 * 1024 * 1024,
                },
            );
            return stdout;
        } finally {
            cleanup();
        }
    }
}

export default TrivyService;
