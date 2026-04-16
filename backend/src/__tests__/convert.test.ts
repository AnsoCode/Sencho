/**
 * Tests for the authenticated `POST /api/convert` endpoint that wraps the
 * composerize library. Verifies input validation, auth gating, graceful
 * handling of malformed commands, and output shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDb, cleanupTestDb, loginAsTestAdmin } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;
let cookie: string;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
  cookie = await loginAsTestAdmin(app);
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

describe('POST /api/convert', () => {
  describe('auth', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/convert')
        .send({ dockerRun: 'docker run nginx' });
      expect(res.status).toBe(401);
    });
  });

  describe('happy path', () => {
    it('converts a simple docker run command', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: 'docker run nginx' });
      expect(res.status).toBe(200);
      expect(typeof res.body.yaml).toBe('string');
      expect(res.body.yaml).toContain('services:');
      expect(res.body.yaml).toContain('nginx');
    });

    it('handles common flags (-p, -v, -e, --name, --restart)', async () => {
      const cmd =
        'docker run -d --name web -p 8080:80 -v /data:/usr/share/nginx/html -e TZ=UTC --restart unless-stopped nginx:alpine';
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: cmd });
      expect(res.status).toBe(200);
      expect(res.body.yaml).toContain('services:');
      expect(res.body.yaml).toContain('web');
      expect(res.body.yaml).toContain('nginx:alpine');
      expect(res.body.yaml).toContain('8080:80');
    });

    it('handles --label and --network flags', async () => {
      const cmd =
        'docker run --name api --label com.example.app=api --network bridge redis:7';
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: cmd });
      expect(res.status).toBe(200);
      expect(res.body.yaml).toContain('services:');
      expect(res.body.yaml).toContain('redis:7');
    });

    it('trims surrounding whitespace', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: '  \n  docker run nginx  \n ' });
      expect(res.status).toBe(200);
      expect(res.body.yaml).toContain('services:');
    });
  });

  describe('input validation', () => {
    it('rejects missing body', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/string/i);
    });

    it('rejects empty string', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    it('rejects whitespace-only input', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: '   \n\t  ' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    it('rejects non-string input', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: 12345 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/string/i);
    });

    it('accepts input at the 8192-char boundary', async () => {
      const prefix = 'docker run nginx ';
      const filler = 'a'.repeat(8192 - prefix.length);
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: prefix + filler });
      // Either composerize accepts (200) or rejects as unparseable (422), but never
      // a 400 "too long" at exactly the max length.
      expect([200, 422]).toContain(res.status);
    });

    it('rejects input one byte over the 8192-char boundary', async () => {
      const prefix = 'docker run nginx ';
      const filler = 'a'.repeat(8193 - prefix.length);
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: prefix + filler });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/too long/i);
    });

    it('rejects oversized input (>8192 chars)', async () => {
      const big = 'docker run ' + 'x'.repeat(9000);
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: big });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/too long/i);
    });

    it('rejects input with a trailing null byte', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: 'docker run nginx\0' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it('rejects input with a leading null byte', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: '\0docker run nginx' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid/i);
    });

    it('rejects input with an embedded null byte', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: 'docker run \0nginx' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid/i);
    });
  });

  describe('malformed commands', () => {
    it('returns 422 when composerize cannot produce services', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: 'this is not a docker run command' });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/parse|supported/i);
    });

    it('returns 422 for pure gibberish', async () => {
      const res = await request(app)
        .post('/api/convert')
        .set('Cookie', cookie)
        .send({ dockerRun: '!!!@@@###$$$' });
      expect(res.status).toBe(422);
    });
  });
});
