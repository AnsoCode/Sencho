import axios from 'axios';

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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function getSenchoVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../../package.json').version;
}

export interface RemoteMeta {
  version: string | null;
  capabilities: string[];
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
  } catch {
    return { version: null, capabilities: [] };
  }
}
