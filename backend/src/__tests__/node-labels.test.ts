import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, cleanupTestDb } from './helpers/setupTestDb';

let tmpDir: string;
let DatabaseService: typeof import('../services/DatabaseService').DatabaseService;
let NodeLabelService: typeof import('../services/NodeLabelService').NodeLabelService;
let nameCounter = 0;

beforeAll(async () => {
    tmpDir = await setupTestDb();
    ({ DatabaseService } = await import('../services/DatabaseService'));
    ({ NodeLabelService } = await import('../services/NodeLabelService'));
});

afterAll(() => cleanupTestDb(tmpDir));

beforeEach(() => {
    const db = DatabaseService.getInstance().getDb();
    db.prepare('DELETE FROM node_labels').run();
    // Wipe any non-default seeded nodes so each test gets a deterministic node set
    db.prepare("DELETE FROM nodes WHERE is_default = 0").run();
});

function seedNode(): number {
    nameCounter += 1;
    const db = DatabaseService.getInstance().getDb();
    const result = db.prepare(
        `INSERT INTO nodes (name, type, mode, compose_dir, is_default, status, created_at)
         VALUES (?, 'local', 'proxy', '/tmp/compose', 0, 'online', ?)`
    ).run(`testnode-${nameCounter}`, Date.now());
    return result.lastInsertRowid as number;
}

describe('NodeLabelService validation', () => {
    it('rejects empty label', () => {
        const svc = NodeLabelService.getInstance();
        expect(svc.validate('')).toMatchObject({ code: 'empty' });
        expect(svc.validate('   ')).toMatchObject({ code: 'empty' });
    });

    it('rejects label longer than 40 chars', () => {
        const svc = NodeLabelService.getInstance();
        expect(svc.validate('a'.repeat(41))).toMatchObject({ code: 'too_long' });
    });

    it('rejects label with disallowed chars', () => {
        const svc = NodeLabelService.getInstance();
        expect(svc.validate('prod env')).toMatchObject({ code: 'invalid_format' });
        expect(svc.validate('prod/staging')).toMatchObject({ code: 'invalid_format' });
        expect(svc.validate('!')).toMatchObject({ code: 'invalid_format' });
    });

    it('accepts valid labels', () => {
        const svc = NodeLabelService.getInstance();
        expect(svc.validate('prod')).toBeNull();
        expect(svc.validate('PROD-eu-west-1')).toBeNull();
        expect(svc.validate('docker.host_v2')).toBeNull();
    });
});

describe('NodeLabelService CRUD', () => {
    it('adds a label and lists it for the node', () => {
        const id = seedNode();
        const svc = NodeLabelService.getInstance();
        const result = svc.addLabel(id, 'prod');
        expect(result.ok).toBe(true);
        expect(svc.listForNode(id)).toEqual(['prod']);
    });

    it('rejects invalid label without writing', () => {
        const id = seedNode();
        const svc = NodeLabelService.getInstance();
        const result = svc.addLabel(id, 'no spaces');
        expect(result.ok).toBe(false);
        expect(svc.listForNode(id)).toEqual([]);
    });

    it('is idempotent on duplicate adds', () => {
        const id = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(id, 'prod');
        svc.addLabel(id, 'prod');
        expect(svc.listForNode(id)).toEqual(['prod']);
    });

    it('removes a label', () => {
        const id = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(id, 'prod');
        const removed = svc.removeLabel(id, 'prod');
        expect(removed).toBe(true);
        expect(svc.listForNode(id)).toEqual([]);
    });

    it('returns false when removing a missing label', () => {
        const id = seedNode();
        const svc = NodeLabelService.getInstance();
        expect(svc.removeLabel(id, 'never-existed')).toBe(false);
    });

    it('cascades on node delete', () => {
        const id = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(id, 'prod');
        svc.addLabel(id, 'edge');
        DatabaseService.getInstance().getDb().prepare('DELETE FROM nodes WHERE id = ?').run(id);
        expect(svc.listForNode(id)).toEqual([]);
    });

    it('listAll returns a node-id keyed map', () => {
        const a = seedNode();
        const b = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        svc.addLabel(a, 'edge');
        svc.addLabel(b, 'staging');
        const map = svc.listAll();
        expect(map[a]).toEqual(['edge', 'prod']);
        expect(map[b]).toEqual(['staging']);
    });

    it('listDistinct returns sorted unique labels across nodes', () => {
        const a = seedNode();
        const b = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        svc.addLabel(b, 'prod');
        svc.addLabel(b, 'edge');
        expect(svc.listDistinct()).toEqual(['edge', 'prod']);
    });
});

describe('NodeLabelService.matchSelector', () => {
    it('matches by node IDs', () => {
        const a = seedNode();
        const b = seedNode();
        const c = seedNode();
        const svc = NodeLabelService.getInstance();
        const nodes = DatabaseService.getInstance().getNodes();
        const matched = svc.matchSelector({ type: 'nodes', ids: [a, c] }, nodes);
        expect(matched.map(n => n.id).sort()).toEqual([a, c].sort());
        expect(matched.map(n => n.id)).not.toContain(b);
    });

    it('matches by labels.any (one matching label suffices)', () => {
        const a = seedNode();
        const b = seedNode();
        seedNode(); // c has no labels
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        svc.addLabel(b, 'staging');
        const nodes = DatabaseService.getInstance().getNodes();
        const matched = svc.matchSelector({ type: 'labels', any: ['prod', 'staging'], all: [] }, nodes);
        expect(matched.map(n => n.id).sort()).toEqual([a, b].sort());
    });

    it('matches by labels.all (must have every label)', () => {
        const a = seedNode();
        const b = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        svc.addLabel(a, 'docker');
        svc.addLabel(b, 'prod');
        const nodes = DatabaseService.getInstance().getNodes();
        const matched = svc.matchSelector({ type: 'labels', any: [], all: ['prod', 'docker'] }, nodes);
        expect(matched.map(n => n.id)).toEqual([a]);
    });

    it('combines any + all', () => {
        const a = seedNode();
        const b = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        svc.addLabel(a, 'docker');
        svc.addLabel(b, 'staging');
        svc.addLabel(b, 'docker');
        const nodes = DatabaseService.getInstance().getNodes();
        const matched = svc.matchSelector({ type: 'labels', any: ['prod', 'staging'], all: ['docker'] }, nodes);
        expect(matched.map(n => n.id).sort()).toEqual([a, b].sort());
    });

    it('returns empty when label selector is fully empty', () => {
        const a = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        const nodes = DatabaseService.getInstance().getNodes();
        expect(svc.matchSelector({ type: 'labels', any: [], all: [] }, nodes)).toEqual([]);
    });

    it('returns empty for nonexistent labels', () => {
        const a = seedNode();
        const svc = NodeLabelService.getInstance();
        svc.addLabel(a, 'prod');
        const nodes = DatabaseService.getInstance().getNodes();
        expect(svc.matchSelector({ type: 'labels', any: ['never'], all: [] }, nodes)).toEqual([]);
    });
});
