/**
 * Shared diagnostic logging gate.
 *
 * Reads `developer_mode` from the global settings, cached for a short
 * window so hot paths (per-request, per-log-line) do not hit SQLite
 * on every call.
 */

let cachedValue = false;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5_000;

export function isDebugEnabled(): boolean {
  const now = Date.now();
  if (now < cacheExpiry) return cachedValue;

  try {
    // Dynamic require avoids circular-dependency issues when this
    // utility is imported from services that DatabaseService itself
    // depends on, and prevents SQLite side effects during tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseService } = require('../services/DatabaseService');
    cachedValue = DatabaseService.getInstance().getGlobalSettings().developer_mode === '1';
  } catch {
    cachedValue = false;
  }

  cacheExpiry = now + CACHE_TTL_MS;
  return cachedValue;
}
