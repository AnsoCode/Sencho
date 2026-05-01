import { describe, it, expect } from 'vitest';
import { BlueprintAnalyzer } from '../services/BlueprintAnalyzer';

describe('BlueprintAnalyzer.analyze', () => {
    it('classifies a stack with no volumes as stateless', () => {
        const yaml = `
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80"]
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateless');
        expect(r.hasNamedVolumes).toBe(false);
        expect(r.hasBindMounts).toBe(false);
        expect(r.hasExternalVolumes).toBe(false);
    });

    it('classifies a stack with only tmpfs as stateless', () => {
        const yaml = `
services:
  redis:
    image: redis:7
    tmpfs:
      - /var/cache
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateless');
        expect(r.hasBindMounts).toBe(false);
        expect(r.hasNamedVolumes).toBe(false);
    });

    it('classifies a named volume as stateful with reason', () => {
        const yaml = `
services:
  postgres:
    image: postgres:16
    volumes:
      - pg_data:/var/lib/postgresql/data
volumes:
  pg_data:
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateful');
        expect(r.hasNamedVolumes).toBe(true);
        expect(r.reasons.some(s => s.includes('named volume "pg_data"'))).toBe(true);
    });

    it('classifies a relative bind mount as stateful', () => {
        const yaml = `
services:
  postgres:
    image: postgres:16
    volumes:
      - ./data:/var/lib/postgresql/data
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateful');
        expect(r.hasBindMounts).toBe(true);
        expect(r.reasons.some(s => s.includes('bind mount "./data"'))).toBe(true);
    });

    it('classifies an absolute bind mount as stateful', () => {
        const yaml = `
services:
  app:
    image: example
    volumes:
      - /opt/data:/data
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateful');
        expect(r.hasBindMounts).toBe(true);
    });

    it('classifies long-form bind mount as stateful', () => {
        const yaml = `
services:
  app:
    image: example
    volumes:
      - type: bind
        source: /srv/data
        target: /data
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateful');
        expect(r.hasBindMounts).toBe(true);
    });

    it('classifies long-form named volume as stateful', () => {
        const yaml = `
services:
  app:
    image: example
    volumes:
      - type: volume
        source: app_data
        target: /data
volumes:
  app_data:
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateful');
        expect(r.hasNamedVolumes).toBe(true);
    });

    it('classifies a stack with only an external volume as unknown', () => {
        const yaml = `
services:
  app:
    image: example
    volumes:
      - shared_storage:/data
volumes:
  shared_storage:
    external: true
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('unknown');
        expect(r.hasExternalVolumes).toBe(true);
        expect(r.reasons.some(s => s.includes('external volume'))).toBe(true);
    });

    it('treats mixed named + external as stateful (named volumes dominate)', () => {
        const yaml = `
services:
  app:
    image: example
    volumes:
      - app_data:/data
      - shared:/cache
volumes:
  app_data:
  shared:
    external: true
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('stateful');
        expect(r.hasNamedVolumes).toBe(true);
        expect(r.hasExternalVolumes).toBe(true);
    });

    it('returns unknown classification on parse error', () => {
        const yaml = 'services:\n  bad: : nope:';
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.classification).toBe('unknown');
        expect(r.parseError).toBeTruthy();
    });

    it('returns unknown on empty document', () => {
        const r = BlueprintAnalyzer.analyze('');
        expect(r.classification).toBe('unknown');
    });

    it('annotates known data-bearing target paths', () => {
        const yaml = `
services:
  postgres:
    image: postgres:16
    volumes:
      - pg_data:/var/lib/postgresql/data
volumes:
  pg_data:
`;
        const r = BlueprintAnalyzer.analyze(yaml);
        expect(r.reasons.some(s => s.includes('looks data-bearing'))).toBe(true);
    });
});

describe('BlueprintAnalyzer.wouldDestroyVolumes', () => {
    it('returns false when volume names unchanged', () => {
        const a = `
services:
  db:
    image: postgres
    volumes: [pg:/data]
volumes:
  pg:
`;
        expect(BlueprintAnalyzer.wouldDestroyVolumes(a, a)).toBe(false);
    });

    it('returns true when a named volume is removed', () => {
        const before = `
services:
  db:
    image: postgres
    volumes: [pg:/data]
volumes:
  pg:
`;
        const after = `
services:
  db:
    image: postgres
`;
        expect(BlueprintAnalyzer.wouldDestroyVolumes(before, after)).toBe(true);
    });

    it('returns true when a named volume is renamed', () => {
        const before = `
services:
  db:
    image: postgres
    volumes: [pg_data:/data]
volumes:
  pg_data:
`;
        const after = `
services:
  db:
    image: postgres
    volumes: [pg_data_v2:/data]
volumes:
  pg_data_v2:
`;
        expect(BlueprintAnalyzer.wouldDestroyVolumes(before, after)).toBe(true);
    });

    it('returns false when a named volume is added', () => {
        const before = `
services:
  app:
    image: example
`;
        const after = `
services:
  app:
    image: example
    volumes: [data:/d]
volumes:
  data:
`;
        expect(BlueprintAnalyzer.wouldDestroyVolumes(before, after)).toBe(false);
    });

    it('ignores external volumes', () => {
        const before = `
services:
  app:
    image: example
    volumes: [shared:/d]
volumes:
  shared:
    external: true
`;
        const after = `
services:
  app:
    image: example
`;
        expect(BlueprintAnalyzer.wouldDestroyVolumes(before, after)).toBe(false);
    });
});
