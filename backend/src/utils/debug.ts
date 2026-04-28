/**
 * Shared diagnostic logging gate. Reads `developer_mode` from
 * DatabaseService, which caches the global_settings snapshot internally
 * and invalidates on write, so hot-path callers can query freely.
 */

export function isDebugEnabled(): boolean {
  try {
    // Dynamic require avoids circular-dependency issues when this
    // utility is imported from services that DatabaseService itself
    // depends on, and prevents SQLite side effects during tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseService } = require('../services/DatabaseService');
    return DatabaseService.getInstance().getGlobalSettings().developer_mode === '1';
  } catch {
    return false;
  }
}
