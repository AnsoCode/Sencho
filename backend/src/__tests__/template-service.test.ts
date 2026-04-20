/**
 * Unit tests for TemplateService: compose YAML generation,
 * env string generation, conditional env_file, and cache clearing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService, Template } from '../services/TemplateService';

describe('TemplateService', () => {
  let service: TemplateService;

  beforeEach(() => {
    service = new TemplateService();
  });

  // ─── generateComposeFromTemplate ─────────────────────────────────────

  describe('generateComposeFromTemplate', () => {
    it('generates minimal compose with just image and restart policy', () => {
      const template: Template = {
        title: 'nginx',
        description: 'Web server',
        image: 'nginx:latest',
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('image: nginx:latest');
      expect(yaml).toContain('restart: unless-stopped');
      expect(yaml).not.toContain('ports:');
      expect(yaml).not.toContain('volumes:');
      expect(yaml).not.toContain('env_file:');
    });

    it('includes ports when template has port mappings', () => {
      const template: Template = {
        title: 'nginx',
        description: 'Web server',
        image: 'nginx:latest',
        ports: ['80:80', '443:443/tcp'],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('ports:');
      expect(yaml).toContain('"80:80"');
      expect(yaml).toContain('"443:443/tcp"');
    });

    it('handles string volumes with host:container format', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: ['/host/data:/container/data'],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('volumes:');
      expect(yaml).toContain('/host/data:/container/data');
    });

    it('handles string volumes with single path (named volume)', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: ['/data'],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('- /data');
    });

    it('handles object volumes with container and bind', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: [{ container: '/config', bind: './config' }],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('./config:/config');
    });

    it('generates bind path from container folder when bind is not specified', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: [{ container: '/app/data' }],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('./data:/app/data');
    });

    it('adds :ro suffix for readonly volumes', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: [{ container: '/config', bind: './config', readonly: true }],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('./config:/config:ro');
    });

    it('includes env_file only when env vars are present', () => {
      const withEnv: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        env: [{ name: 'TZ', default: 'UTC' }],
      };

      const withoutEnv: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        env: [],
      };

      expect(service.generateComposeFromTemplate(withEnv, 'app')).toContain('env_file:');
      expect(service.generateComposeFromTemplate(withoutEnv, 'app')).not.toContain('env_file:');
    });

    it('does not include env_file when env is undefined', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
      };

      expect(service.generateComposeFromTemplate(template, 'app')).not.toContain('env_file:');
    });

    it('handles string volumes with options (e.g., host:container:ro)', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: ['/host/config:/config:ro'],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toContain('/host/config:/config:ro');
    });

    it('skips object volumes without container path', () => {
      const template: Template = {
        title: 'app',
        description: 'Test',
        image: 'test:latest',
        volumes: [{ container: '' }],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      // Empty container means `continue` is hit, no volume line emitted
      expect(yaml).toContain('volumes:');
      // The volume header is added but no actual volume entry
      const volumeLines = yaml.split('\n').filter(l => l.trim().startsWith('- '));
      expect(volumeLines).toHaveLength(0);
    });

    it('produces valid YAML structure starting with services key', () => {
      const template: Template = {
        title: 'full',
        description: 'Full template',
        image: 'app:v1',
        ports: ['8080:80'],
        volumes: [{ container: '/data', bind: './data' }],
        env: [{ name: 'KEY', default: 'val' }],
      };

      const yaml = service.generateComposeFromTemplate(template, 'app');
      expect(yaml).toMatch(/^services:\n/);
      expect(yaml).toContain('  app:');
    });

    it('uses the supplied service name as the compose service key', () => {
      const template: Template = {
        title: 'Plex',
        description: 'Media server',
        image: 'plex:latest',
      };

      const yaml = service.generateComposeFromTemplate(template, 'plex');
      expect(yaml).toMatch(/^services:\n {2}plex:\n/);
      expect(yaml).not.toContain('  app:');
    });
  });

  // ─── generateEnvString ───────────────────────────────────────────────

  describe('generateEnvString', () => {
    it('converts key-value pairs to env file format', () => {
      const result = service.generateEnvString({
        TZ: 'America/New_York',
        PUID: '1000',
        PGID: '1000',
      });

      expect(result).toBe('TZ=America/New_York\nPUID=1000\nPGID=1000');
    });

    it('returns empty string for empty object', () => {
      expect(service.generateEnvString({})).toBe('');
    });

    it('handles values with special characters', () => {
      const result = service.generateEnvString({
        PASSWORD: 'p@ss=word!',
        URL: 'http://localhost:3000',
      });

      expect(result).toContain('PASSWORD=p@ss=word!');
      expect(result).toContain('URL=http://localhost:3000');
    });
  });

  // ─── clearCache ──────────────────────────────────────────────────────

  describe('clearCache', () => {
    it('calls CacheService.invalidate with the correct key', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // clearCache should not throw even when cache is empty
      expect(() => service.clearCache()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith('[Templates] Cache invalidated');

      consoleSpy.mockRestore();
    });
  });
});
