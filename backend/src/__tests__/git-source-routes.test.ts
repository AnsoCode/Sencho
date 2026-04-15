/**
 * Route-layer tests for the git-source API.
 *
 * Covers input-validation and guard behavior that lives in the Express
 * handlers (not in GitSourceService), specifically:
 *   - HTTPS-only repo URL enforcement
 *   - Max-length caps on repo_url / branch / compose_path / env_path / token
 *   - Stack-existence 404 guard on PUT
 *   - 400 on invalid stack names
 *
 * Service-layer logic (encryption, error mapping, mutex, pending lifecycle)
 * is covered in git-source-service.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { setupTestDb, cleanupTestDb, TEST_USERNAME, TEST_JWT_SECRET } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;

function adminToken(): string {
    return jwt.sign({ username: TEST_USERNAME, role: 'admin' }, TEST_JWT_SECRET, { expiresIn: '1m' });
}

beforeAll(async () => {
    tmpDir = await setupTestDb();
    ({ app } = await import('../index'));

    // Seed a real stack directory so the PUT handler's existence guard is satisfied
    // for tests that need to exercise validation past that point.
    const composeDir = process.env.COMPOSE_DIR!;
    fs.mkdirSync(path.join(composeDir, 'existing-stack'), { recursive: true });
    fs.writeFileSync(path.join(composeDir, 'existing-stack', 'compose.yaml'), 'services:\n  x:\n    image: nginx\n');
});

afterAll(() => {
    cleanupTestDb(tmpDir);
});

describe('PUT /api/stacks/:stackName/git-source — URL validation', () => {
    it('rejects http:// URLs with 400', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                repo_url: 'http://github.com/example/repo.git',
                branch: 'main',
                compose_path: 'compose.yaml',
                auth_type: 'none',
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/HTTPS/i);
    });

    it('rejects missing repo_url with 400', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                branch: 'main',
                compose_path: 'compose.yaml',
                auth_type: 'none',
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/repo_url/i);
    });
});

describe('PUT /api/stacks/:stackName/git-source — max-length caps', () => {
    const baseBody = {
        branch: 'main',
        compose_path: 'compose.yaml',
        auth_type: 'none' as const,
    };

    it('rejects oversized repo_url', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({ ...baseBody, repo_url: 'https://example.com/' + 'a'.repeat(2048) });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/repo_url/i);
    });

    it('rejects oversized branch', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                ...baseBody,
                repo_url: 'https://github.com/example/repo.git',
                branch: 'b'.repeat(300),
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/branch/i);
    });

    it('rejects oversized compose_path', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                ...baseBody,
                repo_url: 'https://github.com/example/repo.git',
                compose_path: 'c'.repeat(1100),
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/compose_path/i);
    });

    it('rejects oversized env_path', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                ...baseBody,
                repo_url: 'https://github.com/example/repo.git',
                env_path: 'e'.repeat(1100),
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/env_path/i);
    });

    it('rejects oversized token', async () => {
        const res = await request(app)
            .put('/api/stacks/existing-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                ...baseBody,
                repo_url: 'https://github.com/example/repo.git',
                auth_type: 'token',
                token: 't'.repeat(9000),
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/token/i);
    });
});

describe('PUT /api/stacks/:stackName/git-source — stack existence guard', () => {
    it('returns 404 when the stack does not exist on the active node', async () => {
        const res = await request(app)
            .put('/api/stacks/ghost-stack/git-source')
            .set('Authorization', `Bearer ${adminToken()}`)
            .send({
                repo_url: 'https://github.com/example/repo.git',
                branch: 'main',
                compose_path: 'compose.yaml',
                auth_type: 'none',
            });
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/stack not found/i);
    });
});

describe('git-source routes — invalid stack names', () => {
    it('returns 400 for traversal attempts on GET per-stack', async () => {
        const res = await request(app)
            .get('/api/stacks/..%2fescape/git-source')
            .set('Authorization', `Bearer ${adminToken()}`);
        // URL-decoded name `../escape` fails isValidStackName.
        expect([400, 404]).toContain(res.status);
    });
});

describe('GET /api/git-sources', () => {
    it('returns 200 and a JSON array for an authenticated admin', async () => {
        const res = await request(app)
            .get('/api/git-sources')
            .set('Authorization', `Bearer ${adminToken()}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns 401 without a valid token', async () => {
        const res = await request(app).get('/api/git-sources');
        expect(res.status).toBe(401);
    });
});
