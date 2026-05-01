import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { buildAliasHosts, generateOverrideYaml } from '../services/MeshComposeOverride';

describe('generateOverrideYaml', () => {
    it('emits services with extra_hosts pointing to host-gateway', () => {
        const yaml = generateOverrideYaml({
            services: ['web', 'cache'],
            aliases: [
                { host: 'db.api.opsix.sencho' },
                { host: 'etl.worker.opsix.sencho' },
            ],
        });
        const parsed = YAML.parse(yaml) as Record<string, unknown>;
        expect(parsed.networks).toBeUndefined();
        const services = parsed.services as Record<string, { extra_hosts: string[] }>;
        expect(Object.keys(services).sort()).toEqual(['cache', 'web']);
        for (const svc of ['web', 'cache']) {
            expect(services[svc].extra_hosts).toEqual([
                'db.api.opsix.sencho:host-gateway',
                'etl.worker.opsix.sencho:host-gateway',
            ]);
        }
    });

    it('emits empty service stubs when no aliases exist yet', () => {
        const yaml = generateOverrideYaml({
            services: ['web'],
            aliases: [],
        });
        const parsed = YAML.parse(yaml) as Record<string, unknown>;
        const services = parsed.services as Record<string, { extra_hosts?: string[] }>;
        expect(services.web.extra_hosts).toBeUndefined();
    });

    it('produces stable output regardless of input ordering', () => {
        const a = generateOverrideYaml({
            services: ['web', 'cache'],
            aliases: [
                { host: 'b.x.y.sencho' },
                { host: 'a.x.y.sencho' },
            ],
        });
        const b = generateOverrideYaml({
            services: ['cache', 'web'],
            aliases: [
                { host: 'a.x.y.sencho' },
                { host: 'b.x.y.sencho' },
            ],
        });
        expect(a).toBe(b);
    });
});

describe('buildAliasHosts', () => {
    it('maps services to alias hostnames', () => {
        const out = buildAliasHosts({
            nodeName: 'opsix',
            stackName: 'api',
            services: [{ service: 'db', ports: [5432] }, { service: 'cache', ports: [6379] }],
        });
        expect(out).toEqual(['db.api.opsix.sencho', 'cache.api.opsix.sencho']);
    });
});
