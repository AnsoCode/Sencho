/**
 * Tests for per-stack auto-update settings:
 *   - DatabaseService accessors (round-trip, defaults)
 *   - GET/PUT /api/stacks/auto-update-settings and /api/stacks/:name/auto-update
 *   - /api/auto-update/execute skips disabled stacks
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

  const viewerHash = await bcrypt.hash('viewerpass2', 1);
  DatabaseService.getInstance().addUser({ username: 'aus-viewer', password_hash: viewerHash, role: 'viewer' });
  const viewerRes = await request(app).post('/api/auth/login').send({ username: 'aus-viewer', password: 'viewerpass2' });
  const cookies = viewerRes.headers['set-cookie'] as string | string[];
  viewerCookie = Array.isArray(cookies) ? cookies[0] : cookies;
});

afterAll(() => cleanupTestDb(tmpDir));

describe('DatabaseService - stack auto-update settings', () => {
  it('returns true by default when no row exists', () => {
    const db = DatabaseService.getInstance();
    const result = db.getStackAutoUpdateEnabled(0, 'no-such-stack');
    expect(result).toBe(true);
  });

  it('upsert → get round-trip (disable)', () => {
    const db = DatabaseService.getInstance();
    db.upsertStackAutoUpdateEnabled(0, 'test-stack', false);
    expect(db.getStackAutoUpdateEnabled(0, 'test-stack')).toBe(false);
  });

  it('upsert → get round-trip (re-enable)', () => {
    const db = DatabaseService.getInstance();
    db.upsertStackAutoUpdateEnabled(0, 'test-stack', true);
    expect(db.getStackAutoUpdateEnabled(0, 'test-stack')).toBe(true);
  });

  it('getStackAutoUpdateSettingsForNode only returns stacks with explicit rows', () => {
    const db = DatabaseService.getInstance();
    db.upsertStackAutoUpdateEnabled(0, 'explicit-stack', false);
    const settings = db.getStackAutoUpdateSettingsForNode(0);
    expect('explicit-stack' in settings).toBe(true);
    expect(settings['explicit-stack']).toBe(false);
  });

  it('clearStackAutoUpdateSetting removes the row (reverts to default true)', () => {
    const db = DatabaseService.getInstance();
    db.upsertStackAutoUpdateEnabled(0, 'to-clear', false);
    db.clearStackAutoUpdateSetting(0, 'to-clear');
    expect(db.getStackAutoUpdateEnabled(0, 'to-clear')).toBe(true);
    const settings = db.getStackAutoUpdateSettingsForNode(0);
    expect('to-clear' in settings).toBe(false);
  });
});

describe('GET /api/stacks/auto-update-settings', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/stacks/auto-update-settings');
    expect(res.status).toBe(401);
  });

  it('returns an object for authenticated admin', async () => {
    const res = await request(app).get('/api/stacks/auto-update-settings').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('returns an object for authenticated viewer (read-only)', async () => {
    const res = await request(app).get('/api/stacks/auto-update-settings').set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/stacks/:stackName/auto-update', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/stacks/mystack/auto-update');
    expect(res.status).toBe(401);
  });

  it('returns enabled:true by default', async () => {
    const res = await request(app).get('/api/stacks/nonexistent/auto-update').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('rejects invalid stack names with 400', async () => {
    // Dots are rejected by isValidStackName; unlike path-traversal sequences
    // they are not normalised away by Express routing.
    const res = await request(app).get('/api/stacks/my.stack/auto-update').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/stacks/:stackName/auto-update', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .put('/api/stacks/mystack/auto-update')
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it('rejects viewer with 403', async () => {
    const res = await request(app)
      .put('/api/stacks/mystack/auto-update')
      .set('Cookie', viewerCookie)
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it('rejects Community tier with 403', async () => {
    const { LicenseService } = await import('../services/LicenseService');
    const spy = vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('community');
    try {
      const res = await request(app)
        .put('/api/stacks/mystack/auto-update')
        .set('Cookie', adminCookie)
        .send({ enabled: false });
      expect(res.status).toBe(403);
    } finally {
      // Use mockReturnValue rather than mockRestore: restoring would bypass the
      // beforeAll spy that sets the tier to 'paid' for the rest of the suite.
      spy.mockReturnValue('paid');
    }
  });

  it('rejects non-boolean enabled with 400', async () => {
    const res = await request(app)
      .put('/api/stacks/mystack/auto-update')
      .set('Cookie', adminCookie)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid stack names with 400', async () => {
    // Dots are rejected by isValidStackName; unlike path-traversal sequences
    // they are not normalised away by Express routing.
    const res = await request(app)
      .put('/api/stacks/my.stack/auto-update')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(400);
  });

  it('accepts Skipper/Admiral admin and persists the setting', async () => {
    const res = await request(app)
      .put('/api/stacks/my-app/auto-update')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);

    const db = DatabaseService.getInstance();
    const node = db.getNodes().find(n => n.type === 'local');
    expect(db.getStackAutoUpdateEnabled(node!.id, 'my-app')).toBe(false);
  });

  it('can re-enable a disabled stack', async () => {
    await request(app)
      .put('/api/stacks/my-app/auto-update')
      .set('Cookie', adminCookie)
      .send({ enabled: false });
    const res = await request(app)
      .put('/api/stacks/my-app/auto-update')
      .set('Cookie', adminCookie)
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });
});

describe('POST /api/auto-update/execute - per-stack disable gate', () => {
  it('skips stacks with auto-updates disabled', async () => {
    const db = DatabaseService.getInstance();
    const node = db.getNodes().find(n => n.type === 'local')!;

    db.upsertStackAutoUpdateEnabled(node.id, 'disabled-stack', false);

    // Mock FileSystemService so target='*' returns our test stack
    const fsMod = await import('../services/FileSystemService');
    const getStacksSpy = vi.spyOn(fsMod.FileSystemService.prototype, 'getStacks')
      .mockResolvedValue(['disabled-stack']);

    try {
      const res = await request(app)
        .post('/api/auto-update/execute')
        .set('Cookie', adminCookie)
        .send({ target: '*' });
      expect(res.status).toBe(200);
      expect(res.body.result).toContain('auto-updates disabled; skipped');
    } finally {
      getStacksSpy.mockRestore();
      db.clearStackAutoUpdateSetting(node.id, 'disabled-stack');
    }
  });

  it('skips a named disabled stack', async () => {
    const db = DatabaseService.getInstance();
    const node = db.getNodes().find(n => n.type === 'local')!;
    db.upsertStackAutoUpdateEnabled(node.id, 'named-disabled', false);

    try {
      const res = await request(app)
        .post('/api/auto-update/execute')
        .set('Cookie', adminCookie)
        .send({ target: 'named-disabled' });
      expect(res.status).toBe(200);
      expect(res.body.result).toContain('auto-updates disabled; skipped');
    } finally {
      db.clearStackAutoUpdateSetting(node.id, 'named-disabled');
    }
  });

  it('allows enabled stacks to proceed (may fail at image check, but not at disable gate)', async () => {
    const db = DatabaseService.getInstance();
    const node = db.getNodes().find(n => n.type === 'local')!;
    db.upsertStackAutoUpdateEnabled(node.id, 'enabled-stack', true);

    try {
      const res = await request(app)
        .post('/api/auto-update/execute')
        .set('Cookie', adminCookie)
        .send({ target: 'enabled-stack' });
      expect(res.status).toBe(200);
      // Should NOT contain "auto-updates disabled" in result
      expect(res.body.result).not.toContain('auto-updates disabled; skipped');
    } finally {
      db.clearStackAutoUpdateSetting(node.id, 'enabled-stack');
    }
  });
});
