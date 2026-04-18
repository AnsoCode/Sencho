import { describe, it, expect } from 'vitest';
import {
    annotateEntries,
    computeAuditStats,
    isUnusualHour,
} from '../services/AuditAnomalyService';
import type { AuditLogEntry } from '../services/DatabaseService';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
    return {
        id: 0,
        timestamp: Date.now(),
        username: 'alice',
        method: 'POST',
        path: '/api/stacks/deploy',
        status_code: 200,
        node_id: null,
        ip_address: '10.0.0.1',
        summary: 'Deployed stack web',
        ...overrides,
    };
}

describe('AuditAnomalyService - isUnusualHour', () => {
    it('returns false when baseline is too small to trust', () => {
        expect(isUnusualHour(3, [9, 10, 11])).toBe(false);
    });

    it('returns false when hour is inside the actor typical range', () => {
        const baseline = [9, 10, 10, 11, 11, 12, 13, 14, 15, 16];
        expect(isUnusualHour(11, baseline)).toBe(false);
    });

    it('returns true when hour is well outside the baseline', () => {
        const baseline = [9, 10, 10, 11, 11, 12, 13, 14, 15, 16];
        expect(isUnusualHour(3, baseline)).toBe(true);
    });
});

describe('AuditAnomalyService - annotateEntries', () => {
    it('flags first_seen_actor when the actor has no prior history', () => {
        const now = Date.now();
        const current = [entry({ id: 1, timestamp: now, username: 'newbie' })];
        const result = annotateEntries(current, [], now);
        expect(result[0].flags).toContain('first_seen_actor');
    });

    it('does not flag first_seen_actor when actor appears in history', () => {
        const now = Date.now();
        const history = [entry({ id: 1, timestamp: now - DAY, username: 'alice' })];
        const current = [entry({ id: 2, timestamp: now, username: 'alice' })];
        const result = annotateEntries(current, history, now);
        expect(result[0].flags).not.toContain('first_seen_actor');
    });

    it('flags new_ip when actor has history but not from this ip', () => {
        const now = Date.now();
        const history = Array.from({ length: 6 }, (_, i) =>
            entry({ id: i + 1, timestamp: now - (i + 1) * HOUR, ip_address: '10.0.0.1' })
        );
        const current = [entry({ id: 99, timestamp: now, ip_address: '45.76.1.2' })];
        const result = annotateEntries(current, history, now);
        expect(result[0].flags).toContain('new_ip');
    });

    it('does not flag new_ip when ip matches historical value', () => {
        const now = Date.now();
        const history = [entry({ id: 1, timestamp: now - HOUR, ip_address: '10.0.0.1' })];
        const current = [entry({ id: 2, timestamp: now, ip_address: '10.0.0.1' })];
        const result = annotateEntries(current, history, now);
        expect(result[0].flags).not.toContain('new_ip');
    });

    it('ignores ips older than the 30-day window when scoring new_ip', () => {
        const now = Date.now();
        const history = [
            entry({ id: 1, timestamp: now - 45 * DAY, ip_address: '10.0.0.9' }),
            entry({ id: 2, timestamp: now - 2 * DAY, ip_address: '10.0.0.1' }),
        ];
        const current = [entry({ id: 3, timestamp: now, ip_address: '10.0.0.9' })];
        const result = annotateEntries(current, history, now);
        expect(result[0].flags).toContain('new_ip');
    });

    it('flags unusual_hour when entry falls outside the 7-day hour distribution', () => {
        const now = new Date('2026-04-18T03:15:00Z').getTime();
        const history = Array.from({ length: 10 }, (_, i) => {
            const ts = new Date('2026-04-15T10:00:00Z').getTime() + i * HOUR * 0.5;
            return entry({ id: i + 1, timestamp: ts, ip_address: '10.0.0.1' });
        });
        const current = [entry({ id: 99, timestamp: now })];
        const result = annotateEntries(current, history, now);
        expect(result[0].flags).toContain('unusual_hour');
    });

    it('does not flag unusual_hour when baseline is smaller than the minimum', () => {
        const now = Date.now();
        const history = [entry({ id: 1, timestamp: now - HOUR })];
        const current = [entry({ id: 2, timestamp: now })];
        const result = annotateEntries(current, history, now);
        expect(result[0].flags).not.toContain('unusual_hour');
    });

    it('returns empty flags for entries without a username', () => {
        const now = Date.now();
        const current = [entry({ id: 1, username: '' })];
        const result = annotateEntries(current, [], now);
        expect(result[0].flags).toEqual([]);
    });
});

describe('AuditAnomalyService - computeAuditStats', () => {
    function buildEntries(now: number): { last24h: AuditLogEntry[]; last7d: AuditLogEntry[]; last30d: AuditLogEntry[] } {
        const last24h: AuditLogEntry[] = [];
        for (let i = 0; i < 20; i++) {
            last24h.push(entry({
                id: i + 1,
                timestamp: now - i * HOUR,
                status_code: i < 3 ? 500 : 200,
                ip_address: i === 5 ? '45.76.1.2' : '10.0.0.1',
            }));
        }
        const older: AuditLogEntry[] = [];
        for (let i = 0; i < 60; i++) {
            older.push(entry({
                id: 100 + i,
                timestamp: now - DAY - i * HOUR,
                ip_address: '10.0.0.1',
            }));
        }
        return {
            last24h,
            last7d: [...last24h, ...older.filter(e => e.timestamp >= now - 7 * DAY)],
            last30d: [...last24h, ...older],
        };
    }

    it('summarizes events, actors, failures, and peak hour', () => {
        const now = new Date('2026-04-18T12:00:00Z').getTime();
        const { last24h, last7d, last30d } = buildEntries(now);
        const stats = computeAuditStats({ now, last24h, last7d, last30d });
        expect(stats.events_24h.value).toBe(20);
        expect(stats.actors_24h.value).toBe(1);
        expect(stats.failure_rate.value).toBe(15);
        expect(stats.activity_by_hour).toHaveLength(24);
        expect(stats.activity_by_hour.reduce((a, b) => a + b, 0)).toBe(20);
    });

    it('flags the new_ip detail when an actor uses an ip not seen in prior 29 days', () => {
        const now = new Date('2026-04-18T12:00:00Z').getTime();
        const { last24h, last7d, last30d } = buildEntries(now);
        const stats = computeAuditStats({ now, last24h, last7d, last30d });
        expect(stats.actors_24h.detail).toMatch(/new ip/);
    });

    it('surfaces peak hour when it falls outside working hours', () => {
        const now = new Date(2026, 3, 18, 12, 0, 0).getTime();
        const nightBase = new Date(2026, 3, 18, 3, 15, 0).getTime();
        const nightEntries: AuditLogEntry[] = Array.from({ length: 10 }, (_, i) =>
            entry({ id: i + 1, timestamp: nightBase - i * 5000 })
        );
        const stats = computeAuditStats({ now, last24h: nightEntries, last7d: nightEntries, last30d: nightEntries });
        expect(stats.unusual_hour.severity).toBe('warn');
        expect(stats.unusual_hour.value).toBe(3);
    });
});
