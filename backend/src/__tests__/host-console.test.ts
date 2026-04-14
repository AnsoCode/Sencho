/**
 * Tests for the Host Console feature: environment sanitization, session limits,
 * and console-token RBAC enforcement.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { setupTestDb, cleanupTestDb, TEST_USERNAME, TEST_JWT_SECRET } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  // Mock LicenseService so Admiral-gated endpoints accept requests
  const { LicenseService } = await import('../services/LicenseService');
  vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('paid');
  vi.spyOn(LicenseService.getInstance(), 'getVariant').mockReturnValue('admiral');
  ({ app } = await import('../index'));
});

afterAll(() => {
  vi.restoreAllMocks();
  cleanupTestDb(tmpDir);
});

// ─── Environment Variable Sanitization ──────────────────────────────────────

describe('HostTerminalService.sanitizeEnv', () => {
  let sanitizeEnv: (env: Record<string, string>) => Record<string, string>;

  beforeAll(async () => {
    const mod = await import('../services/HostTerminalService');
    sanitizeEnv = mod.HostTerminalService.sanitizeEnv;
  });

  it('strips DATABASE_URL (explicit blocklist)', () => {
    const result = sanitizeEnv({ DATABASE_URL: 'postgres://...', PATH: '/usr/bin' });
    expect(result).not.toHaveProperty('DATABASE_URL');
    expect(result).toHaveProperty('PATH', '/usr/bin');
  });

  it('strips REDIS_URL, MONGO_URI, AMQP_URL, DSN (explicit blocklist)', () => {
    const result = sanitizeEnv({
      REDIS_URL: 'redis://localhost',
      MONGO_URI: 'mongodb://localhost',
      AMQP_URL: 'amqp://localhost',
      DSN: 'sentry://...',
      HOME: '/home/user',
    });
    expect(result).not.toHaveProperty('REDIS_URL');
    expect(result).not.toHaveProperty('MONGO_URI');
    expect(result).not.toHaveProperty('AMQP_URL');
    expect(result).not.toHaveProperty('DSN');
    expect(result).toHaveProperty('HOME');
  });

  it('strips vars matching SECRET pattern', () => {
    const result = sanitizeEnv({ JWT_SECRET: 'abc', APP_SECRET_KEY: 'xyz', LANG: 'en' });
    expect(result).not.toHaveProperty('JWT_SECRET');
    expect(result).not.toHaveProperty('APP_SECRET_KEY');
    expect(result).toHaveProperty('LANG');
  });

  it('strips vars matching PASSWORD pattern', () => {
    const result = sanitizeEnv({ DB_PASSWORD: 'pass', SMTP_PASSWORD: 'pass', USER: 'me' });
    expect(result).not.toHaveProperty('DB_PASSWORD');
    expect(result).not.toHaveProperty('SMTP_PASSWORD');
    expect(result).toHaveProperty('USER');
  });

  it('strips vars matching TOKEN pattern', () => {
    const result = sanitizeEnv({ API_TOKEN: '123', GITHUB_TOKEN: 'ghp_...', TERM: 'xterm' });
    expect(result).not.toHaveProperty('API_TOKEN');
    expect(result).not.toHaveProperty('GITHUB_TOKEN');
    expect(result).toHaveProperty('TERM');
  });

  it('strips vars matching KEY pattern', () => {
    const result = sanitizeEnv({ AWS_ACCESS_KEY_ID: 'AKIA...', ENCRYPTION_KEY: 'k', SHELL: '/bin/bash' });
    expect(result).not.toHaveProperty('AWS_ACCESS_KEY_ID');
    expect(result).not.toHaveProperty('ENCRYPTION_KEY');
    expect(result).toHaveProperty('SHELL');
  });

  it('strips vars matching CREDENTIAL pattern', () => {
    const result = sanitizeEnv({ GCP_CREDENTIAL: 'json...', PATH: '/usr/bin' });
    expect(result).not.toHaveProperty('GCP_CREDENTIAL');
    expect(result).toHaveProperty('PATH');
  });

  it('strips vars matching PRIVATE pattern', () => {
    const result = sanitizeEnv({ SSH_PRIVATE_KEY: '-----BEGIN', PRIVATE_KEY_PEM: 'pem', HOSTNAME: 'box' });
    expect(result).not.toHaveProperty('SSH_PRIVATE_KEY');
    expect(result).not.toHaveProperty('PRIVATE_KEY_PEM');
    expect(result).toHaveProperty('HOSTNAME');
  });

  it('strips vars matching AUTH pattern', () => {
    const result = sanitizeEnv({ GITHUB_AUTH: 'token', OAUTH_CLIENT: 'id', COMPOSE_DIR: '/app' });
    expect(result).not.toHaveProperty('GITHUB_AUTH');
    expect(result).not.toHaveProperty('OAUTH_CLIENT');
    expect(result).toHaveProperty('COMPOSE_DIR');
  });

  it('strips vars matching PASSPHRASE pattern', () => {
    const result = sanitizeEnv({ GPG_PASSPHRASE: 'secret', PWD: '/home' });
    expect(result).not.toHaveProperty('GPG_PASSPHRASE');
    expect(result).toHaveProperty('PWD');
  });

  it('strips vars matching ENCRYPT pattern', () => {
    const result = sanitizeEnv({ ENCRYPT_KEY: 'abc', ENCRYPTION_ALGO: 'aes', NODE_ENV: 'prod' });
    expect(result).not.toHaveProperty('ENCRYPT_KEY');
    expect(result).not.toHaveProperty('ENCRYPTION_ALGO');
    expect(result).toHaveProperty('NODE_ENV');
  });

  it('strips vars matching SIGNING pattern', () => {
    const result = sanitizeEnv({ SIGNING_KEY: 'key', JWT_SIGNING_SECRET: 's', LC_ALL: 'C' });
    expect(result).not.toHaveProperty('SIGNING_KEY');
    expect(result).not.toHaveProperty('JWT_SIGNING_SECRET');
    expect(result).toHaveProperty('LC_ALL');
  });

  it('preserves safe environment variables', () => {
    const safe = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      COMPOSE_DIR: '/app/compose',
      NODE_ENV: 'production',
      TERM: 'xterm-256color',
      SHELL: '/bin/bash',
      LANG: 'en_US.UTF-8',
    };
    const result = sanitizeEnv(safe);
    expect(result).toEqual(safe);
  });

  it('pattern matching is case-insensitive', () => {
    const result = sanitizeEnv({ my_secret: 'val', My_Password: 'val', PATH: '/usr/bin' });
    expect(result).not.toHaveProperty('my_secret');
    expect(result).not.toHaveProperty('My_Password');
    expect(result).toHaveProperty('PATH');
  });
});

// ─── Session Limit ──────────────────────────────────────────────────────────

describe('HostTerminalService session tracking', () => {
  let HostTerminalService: typeof import('../services/HostTerminalService').HostTerminalService;

  beforeAll(async () => {
    const mod = await import('../services/HostTerminalService');
    HostTerminalService = mod.HostTerminalService;
  });

  it('activeSessions map is accessible and starts empty', () => {
    // Clear any leftover sessions
    HostTerminalService.activeSessions.clear();
    expect(HostTerminalService.activeSessions.size).toBe(0);
  });
});

// ─── Console Token RBAC ─────────────────────────────────────────────────────

describe('POST /api/system/console-token', () => {
  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/api/system/console-token');
    expect(res.status).toBe(401);
  });

  it('returns 200 for admin user', async () => {
    const token = jwt.sign({ username: TEST_USERNAME }, TEST_JWT_SECRET, { expiresIn: '1m' });
    const res = await request(app)
      .post('/api/system/console-token')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
  });

  it('returns 403 for non-admin user (viewer role)', async () => {
    // Create a viewer user in the DB
    const { DatabaseService } = await import('../services/DatabaseService');
    const db = DatabaseService.getInstance();
    const viewerHash = await bcrypt.hash('viewerpass', 1);
    db.addUser({ username: 'viewer_test', password_hash: viewerHash, role: 'viewer' });

    const token = jwt.sign({ username: 'viewer_test' }, TEST_JWT_SECRET, { expiresIn: '1m' });
    const res = await request(app)
      .post('/api/system/console-token')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for deployer role', async () => {
    const { DatabaseService } = await import('../services/DatabaseService');
    const db = DatabaseService.getInstance();
    const deployerHash = await bcrypt.hash('deployerpass', 1);
    db.addUser({ username: 'deployer_test', password_hash: deployerHash, role: 'deployer' });

    const token = jwt.sign({ username: 'deployer_test' }, TEST_JWT_SECRET, { expiresIn: '1m' });
    const res = await request(app)
      .post('/api/system/console-token')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for API tokens', async () => {
    // Create an API token via the admin endpoint first
    const adminToken = jwt.sign({ username: TEST_USERNAME }, TEST_JWT_SECRET, { expiresIn: '1m' });
    const createRes = await request(app)
      .post('/api/api-tokens')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'test-console-blocked', scope: 'full-admin' });
    expect(createRes.status).toBe(201);
    const apiTokenValue = createRes.body.token;

    const res = await request(app)
      .post('/api/system/console-token')
      .set('Authorization', `Bearer ${apiTokenValue}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCOPE_DENIED');
  });
});
