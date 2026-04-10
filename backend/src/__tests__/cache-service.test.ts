/**
 * Unit tests for CacheService: TTL expiry, inflight deduplication,
 * stale-on-error fallback, namespace invalidation, per-namespace stats,
 * the entry-cap safety guard, and singleton identity.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheService } from '../services/CacheService';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = CacheService.getInstance();
    cache.flush();
  });

  afterEach(() => {
    cache.flush();
    vi.useRealTimers();
  });

  // ─── singleton ────────────────────────────────────────────────────────

  describe('getInstance', () => {
    it('returns the same instance across calls', () => {
      const a = CacheService.getInstance();
      const b = CacheService.getInstance();
      expect(a).toBe(b);
    });
  });

  // ─── getOrFetch: cache hits and misses ────────────────────────────────

  describe('getOrFetch', () => {
    it('calls fetcher on first access and caches the result', async () => {
      const fetcher = vi.fn().mockResolvedValue('fresh-value');
      const result = await cache.getOrFetch('ns:key', 60_000, fetcher);
      expect(result).toBe('fresh-value');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('returns cached value on subsequent access without calling fetcher', async () => {
      const fetcher = vi.fn().mockResolvedValue('cached');
      await cache.getOrFetch('ns:key', 60_000, fetcher);
      const second = await cache.getOrFetch('ns:key', 60_000, fetcher);
      expect(second).toBe('cached');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('refetches after TTL expiry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetcher = vi.fn()
        .mockResolvedValueOnce('v1')
        .mockResolvedValueOnce('v2');

      const first = await cache.getOrFetch('ns:key', 1_000, fetcher);
      expect(first).toBe('v1');

      await vi.advanceTimersByTimeAsync(1_100);

      const second = await cache.getOrFetch('ns:key', 1_000, fetcher);
      expect(second).toBe('v2');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('supports different value types', async () => {
      const obj = { a: 1, b: [2, 3] };
      await cache.getOrFetch('obj:key', 60_000, async () => obj);
      const out = await cache.getOrFetch<typeof obj>('obj:key', 60_000, async () => ({ a: 99, b: [] }));
      expect(out).toEqual(obj);
    });
  });

  // ─── inflight deduplication ──────────────────────────────────────────

  describe('inflight deduplication', () => {
    it('deduplicates concurrent getOrFetch calls for the same key', async () => {
      let resolveFetch!: (value: string) => void;
      const fetcher = vi.fn(() => new Promise<string>((resolve) => {
        resolveFetch = resolve;
      }));

      const p1 = cache.getOrFetch('ns:key', 60_000, fetcher);
      const p2 = cache.getOrFetch('ns:key', 60_000, fetcher);
      const p3 = cache.getOrFetch('ns:key', 60_000, fetcher);

      resolveFetch('shared');
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1).toBe('shared');
      expect(r2).toBe('shared');
      expect(r3).toBe('shared');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('does not deduplicate across different keys', async () => {
      const fetcher = vi.fn(async (v: string) => v);
      await Promise.all([
        cache.getOrFetch('ns:a', 60_000, () => fetcher('a')),
        cache.getOrFetch('ns:b', 60_000, () => fetcher('b')),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('clears inflight after successful fetch so next miss can refetch', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetcher = vi.fn()
        .mockResolvedValueOnce('v1')
        .mockResolvedValueOnce('v2');

      await cache.getOrFetch('ns:key', 500, fetcher);
      await vi.advanceTimersByTimeAsync(600);
      const again = await cache.getOrFetch('ns:key', 500, fetcher);

      expect(again).toBe('v2');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('clears inflight after rejection so a later call can retry', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce('recovered');

      await expect(cache.getOrFetch('ns:key', 60_000, fetcher)).rejects.toThrow('boom');
      const second = await cache.getOrFetch('ns:key', 60_000, fetcher);
      expect(second).toBe('recovered');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  // ─── stale-on-error fallback ─────────────────────────────────────────

  describe('stale-on-error fallback', () => {
    it('returns stale value when fetcher rejects after the entry expires', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const fetcher = vi.fn()
        .mockResolvedValueOnce('original')
        .mockRejectedValueOnce(new Error('upstream down'));

      const fresh = await cache.getOrFetch('ns:key', 1_000, fetcher);
      expect(fresh).toBe('original');

      await vi.advanceTimersByTimeAsync(1_100);

      const stale = await cache.getOrFetch('ns:key', 1_000, fetcher);
      expect(stale).toBe('original');
      expect(fetcher).toHaveBeenCalledTimes(2);

      const stats = cache.getStats();
      expect(stats.ns?.stale).toBe(1);
    });

    it('propagates error when no stale entry exists', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('no fallback'));
      await expect(cache.getOrFetch('ns:key', 60_000, fetcher)).rejects.toThrow('no fallback');
    });
  });

  // ─── synchronous get ─────────────────────────────────────────────────

  describe('get', () => {
    it('returns undefined for missing keys and records a miss', () => {
      expect(cache.get('ns:missing')).toBeUndefined();
      const stats = cache.getStats();
      expect(stats.ns?.misses).toBe(1);
    });

    it('returns the cached value and records a hit', () => {
      cache.set('ns:key', 42, 60_000);
      expect(cache.get<number>('ns:key')).toBe(42);
      const stats = cache.getStats();
      expect(stats.ns?.hits).toBe(1);
    });

    it('returns undefined and records a miss when the entry is expired', () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      cache.set('ns:key', 'v', 1_000);
      vi.advanceTimersByTime(1_500);
      expect(cache.get('ns:key')).toBeUndefined();
      const stats = cache.getStats();
      expect(stats.ns?.misses).toBe(1);
    });
  });

  // ─── invalidate ───────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('removes a single key', async () => {
      await cache.getOrFetch('ns:key', 60_000, async () => 'v');
      cache.invalidate('ns:key');
      const fetcher = vi.fn().mockResolvedValue('refetched');
      const out = await cache.getOrFetch('ns:key', 60_000, fetcher);
      expect(out).toBe('refetched');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for missing keys', () => {
      expect(() => cache.invalidate('ns:missing')).not.toThrow();
    });
  });

  describe('invalidateNamespace', () => {
    it('removes every key within the namespace', async () => {
      await cache.getOrFetch('stats:1', 60_000, async () => 'a');
      await cache.getOrFetch('stats:2', 60_000, async () => 'b');
      await cache.getOrFetch('other:1', 60_000, async () => 'c');

      cache.invalidateNamespace('stats');

      const f1 = vi.fn().mockResolvedValue('refetched-1');
      const f2 = vi.fn().mockResolvedValue('refetched-2');
      const f3 = vi.fn().mockResolvedValue('kept-c');

      expect(await cache.getOrFetch('stats:1', 60_000, f1)).toBe('refetched-1');
      expect(await cache.getOrFetch('stats:2', 60_000, f2)).toBe('refetched-2');
      expect(await cache.getOrFetch('other:1', 60_000, f3)).toBe('c');
      expect(f3).not.toHaveBeenCalled();
    });

    it('does not remove keys with similar but distinct namespaces', async () => {
      await cache.getOrFetch('stats:1', 60_000, async () => 'a');
      await cache.getOrFetch('statsbar:1', 60_000, async () => 'b');

      cache.invalidateNamespace('stats');

      const f = vi.fn().mockResolvedValue('new');
      expect(await cache.getOrFetch('statsbar:1', 60_000, f)).toBe('b');
      expect(f).not.toHaveBeenCalled();
    });

    it('removes a namespace-only key (no colon suffix)', async () => {
      await cache.getOrFetch('singleton', 60_000, async () => 'one');
      cache.invalidateNamespace('singleton');
      const f = vi.fn().mockResolvedValue('two');
      expect(await cache.getOrFetch('singleton', 60_000, f)).toBe('two');
    });
  });

  // ─── stats ────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('counts hits and misses per namespace', async () => {
      await cache.getOrFetch('stats:1', 60_000, async () => 'a'); // miss
      await cache.getOrFetch('stats:1', 60_000, async () => 'x'); // hit
      await cache.getOrFetch('stats:2', 60_000, async () => 'b'); // miss
      await cache.getOrFetch('other:1', 60_000, async () => 'c'); // miss

      const stats = cache.getStats();
      expect(stats.stats).toEqual({ hits: 1, misses: 2, stale: 0, size: 2 });
      expect(stats.other).toEqual({ hits: 0, misses: 1, stale: 0, size: 1 });
    });

    it('only counts live (non-expired) entries in size', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      cache.set('ns:a', 1, 1_000);
      cache.set('ns:b', 2, 10_000);
      vi.advanceTimersByTime(2_000);
      const stats = cache.getStats();
      expect(stats.ns?.size).toBe(1);
    });

    it('returns an empty object after flush', () => {
      cache.set('ns:a', 1, 60_000);
      cache.flush();
      expect(cache.getStats()).toEqual({});
    });
  });

  // ─── flush ────────────────────────────────────────────────────────────

  describe('flush', () => {
    it('clears store, inflight, and stats', async () => {
      await cache.getOrFetch('ns:a', 60_000, async () => 1);
      cache.flush();
      expect(cache.get('ns:a')).toBeUndefined();
      // Reset stats count: after flush the previous miss counter is gone,
      // the single get() call above registers one new miss.
      const stats = cache.getStats();
      expect(stats.ns?.misses).toBe(1);
      expect(stats.ns?.hits).toBe(0);
    });
  });

  // ─── MAX_ENTRIES safety cap ──────────────────────────────────────────

  describe('entry cap safety guard', () => {
    it('refuses new entries once the cap is reached and no expired rows exist', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Fill up to the cap with long-lived entries.
      for (let i = 0; i < 1000; i++) {
        cache.set(`bulk:${i}`, i, 3_600_000);
      }
      // Cap reached with all entries still live: insertion is rejected.
      cache.set('bulk:overflow', 'x', 60_000);
      expect(cache.get('bulk:overflow')).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('purges expired entries to make room for new ones', () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      // Fill with short-lived entries.
      for (let i = 0; i < 1000; i++) {
        cache.set(`bulk:${i}`, i, 500);
      }
      // Expire them all.
      vi.advanceTimersByTime(1_000);
      // A new insertion should trigger a purge and succeed.
      cache.set('bulk:new', 'accepted', 60_000);
      expect(cache.get<string>('bulk:new')).toBe('accepted');
    });

    it('allows overwriting an existing key when the cap is reached', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set(`bulk:${i}`, i, 3_600_000);
      }
      cache.set('bulk:5', 'updated', 60_000);
      expect(cache.get<string>('bulk:5')).toBe('updated');
    });
  });
});
