/**
 * Integration tests for /api/settings (GET/POST/PATCH). These endpoints had
 * zero route-layer coverage prior to Phase 4B of the index.ts refactor; this
 * file locks down the shape before extraction.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { setupTestDb, cleanupTestDb, loginAsTestAdmin } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;
let DatabaseService: typeof import('../services/DatabaseService').DatabaseService;
let adminCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ DatabaseService } = await import('../services/DatabaseService'));

  const { LicenseService } = await import('../services/LicenseService');
  vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('paid');
  vi.spyOn(LicenseService.getInstance(), 'getVariant').mockReturnValue('admiral');
  vi.spyOn(LicenseService.getInstance(), 'getSeatLimits').mockReturnValue({ maxAdmins: null, maxViewers: null });

  ({ app } = await import('../index'));
  adminCookie = await loginAsTestAdmin(app);

  const viewerHash = await bcrypt.hash('viewerpass', 1);
  DatabaseService.getInstance().addUser({ username: 'settings-viewer', password_hash: viewerHash, role: 'viewer' });
  const viewerRes = await request(app).post('/api/auth/login').send({ username: 'settings-viewer', password: 'viewerpass' });
  const cookies = viewerRes.headers['set-cookie'] as string | string[];
  viewerCookie = Array.isArray(cookies) ? cookies[0] : cookies;
});

afterAll(() => cleanupTestDb(tmpDir));

describe('GET /api/settings', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('returns settings for authenticated users', async () => {
    const res = await request(app).get('/api/settings').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Object);
  });

  it('strips auth credentials from the response', async () => {
    const res = await request(app).get('/api/settings').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.auth_username).toBeUndefined();
    expect(res.body.auth_password_hash).toBeUndefined();
    expect(res.body.auth_jwt_secret).toBeUndefined();
  });

  it('allows non-admin users to read settings', async () => {
    // Settings is read-only for non-admins; write is admin-gated separately.
    const res = await request(app).get('/api/settings').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/settings (single-key write)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/settings').send({ key: 'host_cpu_limit', value: '80' });
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Cookie', viewerCookie)
      .send({ key: 'host_cpu_limit', value: '80' });
    expect(res.status).toBe(403);
  });

  it('rejects disallowed setting keys with 400', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Cookie', adminCookie)
      .send({ key: 'auth_jwt_secret', value: 'pwned' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid or disallowed setting key/);
  });

  it('rejects missing value with 400', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Cookie', adminCookie)
      .send({ key: 'host_cpu_limit' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/value is required/);
  });

  it('updates an allowlisted key', async () => {
    const res = await request(app)
      .post('/api/settings')
      .set('Cookie', adminCookie)
      .send({ key: 'host_cpu_limit', value: '75' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const settings = DatabaseService.getInstance().getGlobalSettings();
    expect(settings.host_cpu_limit).toBe('75');
  });
});

describe('PATCH /api/settings (bulk update)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).patch('/api/settings').send({ host_cpu_limit: 50 });
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('Cookie', viewerCookie)
      .send({ host_cpu_limit: 50 });
    expect(res.status).toBe(403);
  });

  it('rejects invalid values with 400 and returns field-level errors', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('Cookie', adminCookie)
      .send({ host_cpu_limit: 9999, log_retention_days: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeInstanceOf(Object);
  });

  it('applies a partial update atomically', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('Cookie', adminCookie)
      .send({ host_cpu_limit: 60, host_ram_limit: 70 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const settings = DatabaseService.getInstance().getGlobalSettings();
    expect(settings.host_cpu_limit).toBe('60');
    expect(settings.host_ram_limit).toBe('70');
  });

  it('accepts an empty body and no-ops successfully', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(200);
  });
});
