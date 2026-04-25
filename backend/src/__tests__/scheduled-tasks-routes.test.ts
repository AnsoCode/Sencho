/**
 * Integration tests for /api/scheduled-tasks. Locks down auth, tier gates,
 * validation, and the list/create/get/update/toggle/run/delete lifecycle
 * before extraction.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
  DatabaseService.getInstance().addUser({ username: 'sched-viewer', password_hash: viewerHash, role: 'viewer' });
  const viewerRes = await request(app).post('/api/auth/login').send({ username: 'sched-viewer', password: 'viewerpass' });
  const cookies = viewerRes.headers['set-cookie'] as string | string[];
  viewerCookie = Array.isArray(cookies) ? cookies[0] : cookies;
});

afterAll(() => cleanupTestDb(tmpDir));

beforeEach(() => {
  // Start each test with an empty scheduled_tasks table.
  const db = DatabaseService.getInstance().getDb();
  db.prepare('DELETE FROM scheduled_tasks').run();
});

describe('GET /api/scheduled-tasks', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/scheduled-tasks');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = await request(app).get('/api/scheduled-tasks').set('Cookie', viewerCookie);
    expect(res.status).toBe(403);
  });

  it('returns an empty array when no tasks exist', async () => {
    const res = await request(app).get('/api/scheduled-tasks').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('enriches each task with computed next_runs inside the window', async () => {
    const db = DatabaseService.getInstance();
    const now = Date.now();
    db.createScheduledTask({
      name: 'nightly-scan',
      target_type: 'system',
      target_id: null,
      node_id: 1,
      action: 'scan',
      cron_expression: '0 0 * * *',
      enabled: 1,
      created_by: 'admin',
      created_at: now,
      updated_at: now,
      last_run_at: null,
      next_run_at: now + 3600_000,
      last_status: null,
      last_error: null,
      prune_targets: null,
      target_services: null,
      prune_label_filter: null,
    });

    const res = await request(app).get('/api/scheduled-tasks?window_hours=48').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('nightly-scan');
    expect(Array.isArray(res.body[0].next_runs)).toBe(true);
  });
});

describe('POST /api/scheduled-tasks', () => {
  const basePayload = {
    name: 'daily-update',
    target_type: 'stack',
    target_id: 'my-stack',
    node_id: 1,
    action: 'update',
    cron_expression: '0 3 * * *',
    enabled: true,
  };

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/scheduled-tasks').send(basePayload);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', viewerCookie).send(basePayload);
    expect(res.status).toBe(403);
  });

  it('creates a task and returns the new record', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', adminCookie).send(basePayload);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('daily-update');
    expect(res.body.action).toBe('update');
    expect(res.body.enabled).toBe(1);
  });

  it('rejects an invalid cron expression with 400', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', adminCookie).send({
      ...basePayload, cron_expression: 'this is not cron',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid cron expression/);
  });

  it('rejects unsupported actions', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', adminCookie).send({
      ...basePayload, action: 'nuke',
    });
    expect(res.status).toBe(400);
  });

  it('rejects action/target_type mismatches', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', adminCookie).send({
      ...basePayload, action: 'snapshot', target_type: 'stack',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Snapshot action requires target_type "fleet"/);
  });

  it('rejects scan without node_id', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', adminCookie).send({
      name: 'nightly-scan', target_type: 'system', action: 'scan', cron_expression: '0 0 * * *',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Scan action requires node_id/);
  });

  it('rejects target_services with wrong action', async () => {
    const res = await request(app).post('/api/scheduled-tasks').set('Cookie', adminCookie).send({
      ...basePayload, action: 'update', target_services: ['web'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/target_services can only be used with restart/);
  });
});

describe('GET /api/scheduled-tasks/:id', () => {
  let taskId: number;
  beforeEach(() => {
    const now = Date.now();
    taskId = DatabaseService.getInstance().createScheduledTask({
      name: 't', target_type: 'stack', target_id: 's', node_id: 1, action: 'update',
      cron_expression: '0 3 * * *', enabled: 1, created_by: 'admin', created_at: now, updated_at: now,
      last_run_at: null, next_run_at: null, last_status: null, last_error: null,
      prune_targets: null, target_services: null, prune_label_filter: null,
    });
  });

  it('returns 404 for missing task', async () => {
    const res = await request(app).get('/api/scheduled-tasks/99999').set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(app).get('/api/scheduled-tasks/not-a-number').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns the task for admin', async () => {
    const res = await request(app).get(`/api/scheduled-tasks/${taskId}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(taskId);
  });
});

describe('PATCH /api/scheduled-tasks/:id/toggle', () => {
  it('flips the enabled flag and recomputes next_run_at', async () => {
    const now = Date.now();
    const id = DatabaseService.getInstance().createScheduledTask({
      name: 't', target_type: 'stack', target_id: 's', node_id: 1, action: 'update',
      cron_expression: '0 3 * * *', enabled: 1, created_by: 'admin', created_at: now, updated_at: now,
      last_run_at: null, next_run_at: now + 1000, last_status: null, last_error: null,
      prune_targets: null, target_services: null, prune_label_filter: null,
    });

    const off = await request(app).patch(`/api/scheduled-tasks/${id}/toggle`).set('Cookie', adminCookie);
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(0);
    expect(off.body.next_run_at).toBeNull();

    const on = await request(app).patch(`/api/scheduled-tasks/${id}/toggle`).set('Cookie', adminCookie);
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(1);
    expect(typeof on.body.next_run_at).toBe('number');
  });
});

describe('DELETE /api/scheduled-tasks/:id', () => {
  it('deletes the task and subsequent GET returns 404', async () => {
    const now = Date.now();
    const id = DatabaseService.getInstance().createScheduledTask({
      name: 't', target_type: 'stack', target_id: 's', node_id: 1, action: 'update',
      cron_expression: '0 3 * * *', enabled: 1, created_by: 'admin', created_at: now, updated_at: now,
      last_run_at: null, next_run_at: null, last_status: null, last_error: null,
      prune_targets: null, target_services: null, prune_label_filter: null,
    });

    const del = await request(app).delete(`/api/scheduled-tasks/${id}`).set('Cookie', adminCookie);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await request(app).get(`/api/scheduled-tasks/${id}`).set('Cookie', adminCookie);
    expect(get.status).toBe(404);
  });
});

describe('GET /api/scheduled-tasks/:id/runs', () => {
  it('returns paginated run history', async () => {
    const now = Date.now();
    const id = DatabaseService.getInstance().createScheduledTask({
      name: 't', target_type: 'stack', target_id: 's', node_id: 1, action: 'update',
      cron_expression: '0 3 * * *', enabled: 1, created_by: 'admin', created_at: now, updated_at: now,
      last_run_at: null, next_run_at: null, last_status: null, last_error: null,
      prune_targets: null, target_services: null, prune_label_filter: null,
    });

    const res = await request(app).get(`/api/scheduled-tasks/${id}/runs`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('runs');
  });
});

describe('POST /api/scheduled-tasks - new lifecycle actions', () => {
  const stackPayload = (action: string) => ({
    name: `test-${action}`,
    target_type: 'stack',
    target_id: 'my-stack',
    node_id: 1,
    action,
    cron_expression: '0 3 * * *',
    enabled: true,
  });

  for (const action of ['auto_backup', 'auto_stop', 'auto_down', 'auto_start']) {
    it(`creates ${action} task successfully (Admiral)`, async () => {
      const res = await request(app)
        .post('/api/scheduled-tasks')
        .set('Cookie', adminCookie)
        .send(stackPayload(action));
      expect(res.status).toBe(201);
      expect(res.body.action).toBe(action);
      expect(res.body.target_type).toBe('stack');
    });

    it(`rejects ${action} with target_type "system"`, async () => {
      const res = await request(app)
        .post('/api/scheduled-tasks')
        .set('Cookie', adminCookie)
        .send({ ...stackPayload(action), target_type: 'system', target_id: null });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/target_type "stack"/);
    });
  }

  it('persists delete_after_run flag', async () => {
    const res = await request(app)
      .post('/api/scheduled-tasks')
      .set('Cookie', adminCookie)
      .send({ ...stackPayload('auto_backup'), delete_after_run: true });
    expect(res.status).toBe(201);
    expect(res.body.delete_after_run).toBe(1);
  });

  it('defaults delete_after_run to 0 when not provided', async () => {
    const res = await request(app)
      .post('/api/scheduled-tasks')
      .set('Cookie', adminCookie)
      .send(stackPayload('auto_stop'));
    expect(res.status).toBe(201);
    expect(res.body.delete_after_run).toBe(0);
  });
});

describe('PUT /api/scheduled-tasks/:id - delete_after_run', () => {
  it('can toggle delete_after_run via update', async () => {
    const now = Date.now();
    const id = DatabaseService.getInstance().createScheduledTask({
      name: 't', target_type: 'stack', target_id: 's', node_id: 1, action: 'auto_backup',
      cron_expression: '0 3 * * *', enabled: 1, created_by: 'admin', created_at: now, updated_at: now,
      last_run_at: null, next_run_at: null, last_status: null, last_error: null,
      prune_targets: null, target_services: null, prune_label_filter: null, delete_after_run: 0,
    });

    const res = await request(app)
      .put(`/api/scheduled-tasks/${id}`)
      .set('Cookie', adminCookie)
      .send({ delete_after_run: true });
    expect(res.status).toBe(200);
    expect(res.body.delete_after_run).toBe(1);

    const res2 = await request(app)
      .put(`/api/scheduled-tasks/${id}`)
      .set('Cookie', adminCookie)
      .send({ delete_after_run: false });
    expect(res2.status).toBe(200);
    expect(res2.body.delete_after_run).toBe(0);
  });
});
