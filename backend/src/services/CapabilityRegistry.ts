import axios from 'axios';
import path from 'path';
import fs from 'fs';

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

export function getSenchoVersion(): string {
  // Walk up from __dirname to find the root package.json (name === 'sencho').
  // In dev this is 3 levels up (src/services/ -> root), in Docker it's 2
  // (dist/services/ -> /app/). Skips intermediate package.json files like
  // backend/package.json which has a different name and version.
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require(candidate);
      if (pkg.name === 'sencho') return pkg.version;
    }
    dir = path.dirname(dir);
  }
  return 'unknown';
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
    return {
      version: res.data.version ?? null,
      capabilities: Array.isArray(res.data.capabilities) ? res.data.capabilities : [],
    };
  } catch (err) {
    console.warn(`[CapabilityRegistry] Failed to fetch meta from ${baseUrl}:`, (err as Error).message);
    return { version: null, capabilities: [] };
  }
}
