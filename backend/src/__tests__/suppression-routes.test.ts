/**
 * Route-level tests for /api/security/suppressions CRUD.
 * Covers: auth gating, paid-tier gating, admin-only writes, replica rejection,
 * CVE format validation, UNIQUE conflict, update/delete behavior.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestDb, cleanupTestDb, TEST_USERNAME, TEST_JWT_SECRET } from './helpers/setupTestDb';
import bcrypt from 'bcrypt';

let tmpDir: string;
let app: import('express').Express;
let adminAuthHeader: string;
let viewerAuthHeader: string;
let LicenseService: typeof import('../services/LicenseService').LicenseService;
let DatabaseService: typeof import('../services/DatabaseService').DatabaseService;
let FleetSyncService: typeof import('../services/FleetSyncService').FleetSyncService;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
  ({ LicenseService } = await import('../services/LicenseService'));
  ({ DatabaseService } = await import('../services/DatabaseService'));
  ({ FleetSyncService } = await import('../services/FleetSyncService'));

  const adminToken = jwt.sign({ username: TEST_USERNAME }, TEST_JWT_SECRET, { expiresIn: '1m' });
  adminAuthHeader = `Bearer ${adminToken}`;

  // Seed a viewer user for admin-gate tests
  const viewerHash = await bcrypt.hash('viewerpass', 1);
  DatabaseService.getInstance().addUser({ username: 'viewer1', password_hash: viewerHash, role: 'viewer' });
  const viewerToken = jwt.sign({ username: 'viewer1' }, TEST_JWT_SECRET, { expiresIn: '1m' });
  viewerAuthHeader = `Bearer ${viewerToken}`;
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

beforeEach(() => {
  // Reset all rows and stubs before every test
  const db = DatabaseService.getInstance();
  db.getCveSuppressions().forEach((s) => db.deleteCveSuppression(s.id));
  vi.restoreAllMocks();
  // Default: paid tier + control role
  vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('paid');
  vi.spyOn(FleetSyncService, 'getRole').mockReturnValue('control');
  // Stub the async fleet push so it doesn't try to hit real nodes
  vi.spyOn(FleetSyncService.getInstance(), 'pushResourceAsync').mockImplementation(() => {});
});

describe('GET /api/security/suppressions', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/security/suppressions');
    expect(res.status).toBe(401);
  });

  it('is accessible on community tier', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('community');
    const res = await request(app).get('/api/security/suppressions').set('Authorization', adminAuthHeader);
    expect(res.status).toBe(200);
    expect(res.body.code).not.toBe('PAID_REQUIRED');
  });

  it('returns an empty list when no suppressions exist', async () => {
    const res = await request(app).get('/api/security/suppressions').set('Authorization', adminAuthHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns rows with active flag computed from expires_at', async () => {
    const db = DatabaseService.getInstance();
    db.createCveSuppression({
      cve_id: 'CVE-2024-1000',
      pkg_name: null,
      image_pattern: null,
      reason: 'still active',
      created_by: TEST_USERNAME,
      created_at: Date.now(),
      expires_at: Date.now() + 60_000,
      replicated_from_control: 0,
    });
    db.createCveSuppression({
      cve_id: 'CVE-2024-1001',
      pkg_name: null,
      image_pattern: null,
      reason: 'already expired',
      created_by: TEST_USERNAME,
      created_at: Date.now() - 10_000,
      expires_at: Date.now() - 1,
      replicated_from_control: 0,
    });

    const res = await request(app).get('/api/security/suppressions').set('Authorization', adminAuthHeader);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const byCve = Object.fromEntries(res.body.map((s: { cve_id: string; active: boolean }) => [s.cve_id, s.active]));
    expect(byCve['CVE-2024-1000']).toBe(true);
    expect(byCve['CVE-2024-1001']).toBe(false);
  });
});

describe('POST /api/security/suppressions', () => {
  const validBody = {
    cve_id: 'CVE-2024-2000',
    pkg_name: 'openssl',
    image_pattern: 'nginx*',
    reason: 'Vendor-confirmed false positive on alpine base images.',
  };

  it('rejects unauthenticated callers with 401', async () => {
    const res = await request(app).post('/api/security/suppressions').send(validBody);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', viewerAuthHeader)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_REQUIRED');
  });

  it('is accessible on community tier (admin still required)', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('community');
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.code).not.toBe('PAID_REQUIRED');
  });

  it('rejects writes on replicas with 403', async () => {
    vi.spyOn(FleetSyncService, 'getRole').mockReturnValue('replica');
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REPLICA_READ_ONLY');
  });

  it('rejects malformed CVE identifiers', async () => {
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send({ ...validBody, cve_id: 'not-a-cve' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cve_id/);
  });

  it('accepts GHSA identifiers', async () => {
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send({ ...validBody, cve_id: 'GHSA-abcd-efgh-ijkl' });
    expect(res.status).toBe(201);
    expect(res.body.cve_id).toBe('GHSA-abcd-efgh-ijkl');
  });

  it('rejects empty reason with 400', async () => {
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send({ ...validBody, reason: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/);
  });

  it('creates a suppression and records created_by from the session', async () => {
    const res = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cve_id: 'CVE-2024-2000',
      pkg_name: 'openssl',
      image_pattern: 'nginx*',
      reason: validBody.reason,
      created_by: TEST_USERNAME,
      replicated_from_control: 0,
    });
    expect(FleetSyncService.getInstance().pushResourceAsync).toHaveBeenCalledWith('cve_suppressions');
  });

  it('returns 409 when the UNIQUE key is violated', async () => {
    const first = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(validBody);
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(validBody);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already exists/i);
  });

  it('treats two NULL-scope entries for the same CVE as duplicates', async () => {
    const minimal = { cve_id: 'CVE-2024-7777', reason: 'wildcard' };
    const first = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(minimal);
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post('/api/security/suppressions')
      .set('Authorization', adminAuthHeader)
      .send(minimal);
    expect(dup.status).toBe(409);
  });
});

describe('PUT /api/security/suppressions/:id', () => {
  it('updates mutable fields and rejects unknown fields silently', async () => {
    const db = DatabaseService.getInstance();
    const created = db.createCveSuppression({
      cve_id: 'CVE-2024-3000',
      pkg_name: null,
      image_pattern: null,
      reason: 'original reason',
      created_by: TEST_USERNAME,
      created_at: Date.now(),
      expires_at: null,
      replicated_from_control: 0,
    });

    const res = await request(app)
      .put(`/api/security/suppressions/${created.id}`)
      .set('Authorization', adminAuthHeader)
      .send({ reason: 'updated reason', image_pattern: 'alpine*', cve_id: 'CVE-2099-9999' });
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('updated reason');
    expect(res.body.image_pattern).toBe('alpine*');
    // cve_id is immutable
    expect(res.body.cve_id).toBe('CVE-2024-3000');
  });

  it('returns 404 for unknown ids', async () => {
    const res = await request(app)
      .put('/api/security/suppressions/99999')
      .set('Authorization', adminAuthHeader)
      .send({ reason: 'whatever' });
    expect(res.status).toBe(404);
  });

  it('rejects writes on replicas', async () => {
    vi.spyOn(FleetSyncService, 'getRole').mockReturnValue('replica');
    const res = await request(app)
      .put('/api/security/suppressions/1')
      .set('Authorization', adminAuthHeader)
      .send({ reason: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/security/suppressions/:id', () => {
  it('deletes an existing row and returns success', async () => {
    const db = DatabaseService.getInstance();
    const created = db.createCveSuppression({
      cve_id: 'CVE-2024-4000',
      pkg_name: null,
      image_pattern: null,
      reason: 'to be removed',
      created_by: TEST_USERNAME,
      created_at: Date.now(),
      expires_at: null,
      replicated_from_control: 0,
    });

    const res = await request(app)
      .delete(`/api/security/suppressions/${created.id}`)
      .set('Authorization', adminAuthHeader);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(db.getCveSuppression(created.id)).toBeNull();
    expect(FleetSyncService.getInstance().pushResourceAsync).toHaveBeenCalledWith('cve_suppressions');
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app)
      .delete('/api/security/suppressions/not-a-number')
      .set('Authorization', adminAuthHeader);
    expect(res.status).toBe(400);
  });

  it('rejects writes on replicas', async () => {
    vi.spyOn(FleetSyncService, 'getRole').mockReturnValue('replica');
    const res = await request(app)
      .delete('/api/security/suppressions/1')
      .set('Authorization', adminAuthHeader);
    expect(res.status).toBe(403);
  });
});
