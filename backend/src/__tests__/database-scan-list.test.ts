/**
 * Coverage for `getVulnerabilityScans` filtering + pagination, used by
 * the scan-history page's server-driven pagination.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, cleanupTestDb } from './helpers/setupTestDb';

let tmpDir: string;
let DatabaseService: typeof import('../services/DatabaseService').DatabaseService;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ DatabaseService } = await import('../services/DatabaseService'));
});

afterAll(() => cleanupTestDb(tmpDir));

function seedScan(overrides: Partial<{
  image_ref: string;
  scanned_at: number;
  status: 'completed' | 'in_progress' | 'failed';
}> = {}): number {
  const db = DatabaseService.getInstance();
  return db.createVulnerabilityScan({
    node_id: 1,
    image_ref: overrides.image_ref ?? 'alpine:3.19',
    image_digest: `sha256:${Math.random().toString(16).slice(2)}`,
    scanned_at: overrides.scanned_at ?? Date.now(),
    total_vulnerabilities: 0,
    critical_count: 0,
    high_count: 0,
    medium_count: 0,
    low_count: 0,
    unknown_count: 0,
    fixable_count: 0,
    secret_count: 0,
    misconfig_count: 0,
    scanners_used: 'vuln',
    highest_severity: null,
    os_info: null,
    trivy_version: null,
    scan_duration_ms: null,
    triggered_by: 'manual',
    status: overrides.status ?? 'completed',
    error: null,
    stack_context: null,
  });
}

function resetTable(): void {
  (DatabaseService.getInstance() as unknown as {
    db: { prepare: (s: string) => { run: () => void } };
  }).db.prepare('DELETE FROM vulnerability_scans').run();
}

beforeEach(() => resetTable());

describe('getVulnerabilityScans filters and pagination', () => {
  it('filters by status=completed', () => {
    const db = DatabaseService.getInstance();
    seedScan({ status: 'completed', scanned_at: 1 });
    seedScan({ status: 'in_progress', scanned_at: 2 });
    seedScan({ status: 'failed', scanned_at: 3 });

    const result = db.getVulnerabilityScans(1, { status: 'completed' });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('completed');
  });

  it('filters by imageRefLike substring, case-sensitive', () => {
    const db = DatabaseService.getInstance();
    seedScan({ image_ref: 'alpine:3.18', scanned_at: 1 });
    seedScan({ image_ref: 'alpine:3.19', scanned_at: 2 });
    seedScan({ image_ref: 'nginx:1.25', scanned_at: 3 });

    const result = db.getVulnerabilityScans(1, { imageRefLike: 'alpine' });
    expect(result.total).toBe(2);
    expect(result.items.every((s) => s.image_ref.startsWith('alpine'))).toBe(true);
  });

  it('returns total independent of limit for pagination', () => {
    const db = DatabaseService.getInstance();
    for (let i = 0; i < 5; i++) seedScan({ scanned_at: i * 1000 });

    const page1 = db.getVulnerabilityScans(1, { limit: 2, offset: 0 });
    const page2 = db.getVulnerabilityScans(1, { limit: 2, offset: 2 });

    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
  });
});
