import axios from 'axios';
import path from 'path';
import fs from 'fs';
import semver from 'semver';
import { SENCHO_VERSION } from '../generated/version';

/**
 * Static registry of capabilities supported by THIS Sencho instance.
 * Append-only: when a new feature ships, add its capability string here.
 * The frontend uses these flags (not semver comparisons) to gate features
 * on nodes that may be running older versions.
 */
export const CAPABILITIES = [
  'stacks',
  'containers',
  'resources',
  'templates',
  'global-logs',
  'system-stats',
  'fleet',
  'auto-updates',
  'labels',
  'webhooks',
  'network-topology',
  'notifications',
  'notification-routing',
  'host-console',
  'audit-log',
  'scheduled-ops',
  'sso',
  'api-tokens',
  'users',
  'registries',
  'self-update',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Returns true when the string is a usable semver version. */
export function isValidVersion(v: string | null | undefined): v is string {
  return !!v && v !== 'unknown' && v !== '0.0.0-dev' && !!semver.valid(v);
}

// Resolved once per process at import time, then cached.
function resolveVersion(): string | null {
  if (SENCHO_VERSION !== '0.0.0-dev') return SENCHO_VERSION;

  // Fallback for manual ts-node runs without the predev hook.
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (pkg.name === 'sencho') return pkg.version;
    } catch { /* not found, keep walking */ }
    dir = path.dirname(dir);
  }
  console.warn('[CapabilityRegistry] Could not resolve Sencho version from any source');
  return null;
}

const cachedVersion = resolveVersion();

export function getSenchoVersion(): string | null {
  return cachedVersion;
}

export interface RemoteMeta {
  version: string | null;
  capabilities: string[];
}

// Runtime capability overrides — services call disableCapability() during init
const disabledCapabilities = new Set<Capability>();

export function disableCapability(c: Capability): void {
  disabledCapabilities.add(c);
}

/** Returns capabilities this instance actually supports at runtime. */
export function getActiveCapabilities(): readonly string[] {
  if (disabledCapabilities.size === 0) return CAPABILITIES;
  return CAPABILITIES.filter(c => !disabledCapabilities.has(c));
}

/** Fetch /api/meta from a remote Sencho instance. Returns empty data on failure. */
export async function fetchRemoteMeta(baseUrl: string, apiToken: string): Promise<RemoteMeta> {
  try {
    const res = await axios.get(`${baseUrl}/api/meta`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      timeout: 5000,
    });
    const rawVersion: string | undefined = res.data.version;
    return {
      version: isValidVersion(rawVersion) ? rawVersion : null,
      capabilities: Array.isArray(res.data.capabilities) ? res.data.capabilities : [],
    };
  } catch (err) {
    console.warn(`[CapabilityRegistry] Failed to fetch meta from ${baseUrl}:`, (err as Error).message);
    return { version: null, capabilities: [] };
  }
}
