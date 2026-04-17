import { describe, it, expect } from 'vitest';
import { severityRank, isSeverityAtLeast, SEVERITY_ORDER } from '../utils/severity';

describe('severityRank', () => {
    it('orders severities CRITICAL > HIGH > MEDIUM > LOW > UNKNOWN', () => {
        expect(severityRank('CRITICAL')).toBeGreaterThan(severityRank('HIGH'));
        expect(severityRank('HIGH')).toBeGreaterThan(severityRank('MEDIUM'));
        expect(severityRank('MEDIUM')).toBeGreaterThan(severityRank('LOW'));
        expect(severityRank('LOW')).toBeGreaterThan(severityRank('UNKNOWN'));
    });

    it('returns -1 for null/undefined so missing severities sort below UNKNOWN', () => {
        expect(severityRank(null)).toBe(-1);
        expect(severityRank(undefined)).toBe(-1);
        expect(severityRank(null)).toBeLessThan(severityRank('UNKNOWN'));
    });

    it('exports a SEVERITY_ORDER array that covers every known severity', () => {
        expect(SEVERITY_ORDER).toEqual(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    });
});

describe('isSeverityAtLeast', () => {
    it('returns true when actual meets or exceeds the threshold', () => {
        expect(isSeverityAtLeast('CRITICAL', 'HIGH')).toBe(true);
        expect(isSeverityAtLeast('HIGH', 'HIGH')).toBe(true);
        expect(isSeverityAtLeast('MEDIUM', 'LOW')).toBe(true);
    });

    it('returns false when actual is below the threshold', () => {
        expect(isSeverityAtLeast('LOW', 'HIGH')).toBe(false);
        expect(isSeverityAtLeast('MEDIUM', 'CRITICAL')).toBe(false);
    });

    it('returns false for missing severities regardless of threshold', () => {
        expect(isSeverityAtLeast(null, 'LOW')).toBe(false);
        expect(isSeverityAtLeast(undefined, 'UNKNOWN')).toBe(false);
    });
});
