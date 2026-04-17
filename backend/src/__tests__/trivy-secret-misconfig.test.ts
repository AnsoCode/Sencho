/**
 * Unit tests for secret and misconfiguration parsing in TrivyService.
 *
 * Covers the new code paths introduced alongside `--scanners vuln,secret` and
 * the `trivy config` stack flow: secret match redaction, misconfig extraction,
 * and the scanner-canonicalization helper that feeds the digest cache key.
 */
import { describe, it, expect } from 'vitest';
import {
    normalizeScanners,
    parseTrivyOutput,
    redactSecretMatch,
} from '../services/TrivyService';

describe('normalizeScanners', () => {
    it('defaults to vuln when input is empty or undefined', () => {
        expect(normalizeScanners()).toEqual(['vuln']);
        expect(normalizeScanners([])).toEqual(['vuln']);
    });

    it('keeps canonical order regardless of input order', () => {
        expect(normalizeScanners(['secret', 'vuln'])).toEqual(['vuln', 'secret']);
        expect(normalizeScanners(['vuln', 'secret'])).toEqual(['vuln', 'secret']);
    });

    it('deduplicates repeated entries', () => {
        expect(normalizeScanners(['vuln', 'vuln', 'secret'])).toEqual(['vuln', 'secret']);
    });

    it('produces a join-stable string so cache keys stay comparable', () => {
        const a = normalizeScanners(['secret', 'vuln']).join(',');
        const b = normalizeScanners(['vuln', 'secret']).join(',');
        expect(a).toBe(b);
        expect(a).toBe('vuln,secret');
    });
});

describe('redactSecretMatch', () => {
    it('returns null for empty, whitespace, or missing input', () => {
        expect(redactSecretMatch(null)).toBeNull();
        expect(redactSecretMatch(undefined)).toBeNull();
        expect(redactSecretMatch('')).toBeNull();
        expect(redactSecretMatch('    ')).toBeNull();
    });

    it('returns the full string (trimmed) when 8 chars or fewer', () => {
        expect(redactSecretMatch('abc')).toBe('abc');
        expect(redactSecretMatch('abcdefgh')).toBe('abcdefgh');
        expect(redactSecretMatch('  short ')).toBe('short');
    });

    it('redacts values longer than 8 chars to first 8 + ellipsis', () => {
        expect(redactSecretMatch('abcdefghi')).toBe('abcdefgh...');
        expect(
            redactSecretMatch('AKIA1234567890ABCDEF'),
        ).toBe('AKIA1234...');
    });

    it('never leaks the full secret even if the match is a long key-like string', () => {
        const leaked = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
        const result = redactSecretMatch(leaked) ?? '';
        expect(result.length).toBeLessThanOrEqual(11);
        expect(result.endsWith('...')).toBe(true);
        expect(leaked.includes(result.replace('...', ''))).toBe(true);
    });
});

describe('parseTrivyOutput - secrets', () => {
    it('extracts secret findings with redacted match excerpts', () => {
        const raw = JSON.stringify({
            Results: [
                {
                    Target: 'app/config.env',
                    Secrets: [
                        {
                            RuleID: 'aws-access-key-id',
                            Category: 'AWS',
                            Severity: 'CRITICAL',
                            Title: 'AWS Access Key ID',
                            StartLine: 12,
                            EndLine: 12,
                            Match: 'AKIAIOSFODNN7EXAMPLE',
                        },
                    ],
                },
            ],
        });
        const parsed = parseTrivyOutput(raw);
        expect(parsed.secrets.length).toBe(1);
        const s = parsed.secrets[0];
        expect(s.ruleId).toBe('aws-access-key-id');
        expect(s.category).toBe('AWS');
        expect(s.severity).toBe('CRITICAL');
        expect(s.target).toBe('app/config.env');
        expect(s.startLine).toBe(12);
        expect(s.matchExcerpt).toBe('AKIAIOSF...');
        expect(s.matchExcerpt?.includes('EXAMPLE')).toBe(false);
    });

    it('drops secret entries missing a rule id', () => {
        const raw = JSON.stringify({
            Results: [
                {
                    Target: 'a',
                    Secrets: [
                        { Severity: 'HIGH', Match: 'x' },
                        { RuleID: 'gh-token', Severity: 'HIGH', Match: 'y' },
                    ],
                },
            ],
        });
        const parsed = parseTrivyOutput(raw);
        expect(parsed.secrets.length).toBe(1);
        expect(parsed.secrets[0].ruleId).toBe('gh-token');
    });

    it('returns an empty secrets array when no Secrets key is present', () => {
        const raw = JSON.stringify({
            Results: [{ Target: 'a', Vulnerabilities: [] }],
        });
        const parsed = parseTrivyOutput(raw);
        expect(parsed.secrets).toEqual([]);
    });
});

describe('parseTrivyOutput - misconfigs', () => {
    it('extracts misconfigurations with resolution and primary url', () => {
        const raw = JSON.stringify({
            Results: [
                {
                    Target: 'docker-compose.yml',
                    Misconfigurations: [
                        {
                            ID: 'DS002',
                            AVDID: 'AVD-DS-0002',
                            Severity: 'HIGH',
                            Title: 'Container running as root',
                            Message: 'Specify a non-root user.',
                            Resolution: 'Set `user:` in the service definition.',
                            PrimaryURL: 'https://avd.aquasec.com/misconfig/ds002',
                        },
                    ],
                },
            ],
        });
        const parsed = parseTrivyOutput(raw);
        expect(parsed.misconfigs.length).toBe(1);
        const m = parsed.misconfigs[0];
        expect(m.ruleId).toBe('DS002');
        expect(m.checkId).toBe('AVD-DS-0002');
        expect(m.severity).toBe('HIGH');
        expect(m.target).toBe('docker-compose.yml');
        expect(m.resolution).toContain('user:');
        expect(m.primaryUrl).toBe('https://avd.aquasec.com/misconfig/ds002');
    });

    it('tolerates missing optional fields', () => {
        const raw = JSON.stringify({
            Results: [
                {
                    Target: 'compose.yml',
                    Misconfigurations: [{ ID: 'X1', Severity: 'LOW' }],
                },
            ],
        });
        const parsed = parseTrivyOutput(raw);
        expect(parsed.misconfigs.length).toBe(1);
        expect(parsed.misconfigs[0].ruleId).toBe('X1');
        expect(parsed.misconfigs[0].severity).toBe('LOW');
    });

    it('returns vulnerabilities, secrets, and misconfigs together when all present', () => {
        const raw = JSON.stringify({
            Results: [
                {
                    Target: 'app',
                    Vulnerabilities: [
                        {
                            VulnerabilityID: 'CVE-2024-1111',
                            PkgName: 'openssl',
                            InstalledVersion: '1.0',
                            Severity: 'HIGH',
                        },
                    ],
                    Secrets: [{ RuleID: 'aws', Severity: 'HIGH', Match: 'secretvalue' }],
                    Misconfigurations: [{ ID: 'M1', Severity: 'MEDIUM' }],
                },
            ],
        });
        const parsed = parseTrivyOutput(raw);
        expect(parsed.vulnerabilities.length).toBe(1);
        expect(parsed.secrets.length).toBe(1);
        expect(parsed.misconfigs.length).toBe(1);
    });
});
