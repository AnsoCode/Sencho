import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDismissalState } from '../useDismissalState';

const KEY = 'test-dismiss-key';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;

describe('useDismissalState', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns dismissed=false when no timestamp is stored', () => {
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(false);
    });

    it('returns dismissed=true when a recent timestamp is stored', () => {
        localStorage.setItem(KEY, String(Date.now() - 1000));
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(true);
    });

    it('returns dismissed=false when the stored timestamp is past the 24h window', () => {
        localStorage.setItem(KEY, String(Date.now() - DISMISS_DURATION_MS - 1));
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(false);
    });

    it('returns dismissed=false when the stored value is non-numeric garbage', () => {
        // Future-proofing: a stale extension or hand-edit could leave a non-
        // numeric value at the key; the hook must not crash and must default
        // to "show the upsell."
        localStorage.setItem(KEY, 'not-a-number');
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(false);
    });

    it('dismiss() flips dismissed to true and writes a parseable timestamp', () => {
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(false);

        act(() => result.current.dismiss());

        expect(result.current.dismissed).toBe(true);
        const stored = localStorage.getItem(KEY);
        expect(stored).not.toBeNull();
        expect(Number.isFinite(Number.parseInt(stored as string, 10))).toBe(true);
    });

    it('restore() flips dismissed to false and removes the storage entry', () => {
        localStorage.setItem(KEY, String(Date.now()));
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(true);

        act(() => result.current.restore());

        expect(result.current.dismissed).toBe(false);
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('respects the 24h boundary: a fresh mount past expiry sees dismissed=false', () => {
        // Dismiss now, then advance time past the window, then mount fresh.
        // The original hook instance keeps its `dismissed: true` state in
        // React (lazy initializer runs once), so the boundary is observable
        // only on a fresh mount, not via re-render of the same hook.
        const { result, unmount } = renderHook(() => useDismissalState(KEY));
        act(() => result.current.dismiss());
        expect(result.current.dismissed).toBe(true);

        unmount();
        vi.advanceTimersByTime(DISMISS_DURATION_MS + 1000);

        const fresh = renderHook(() => useDismissalState(KEY));
        expect(fresh.result.current.dismissed).toBe(false);
    });

    it('different keys are independent', () => {
        const { result: a } = renderHook(() => useDismissalState('key-a'));
        const { result: b } = renderHook(() => useDismissalState('key-b'));

        act(() => a.current.dismiss());

        expect(a.current.dismissed).toBe(true);
        expect(b.current.dismissed).toBe(false);
    });

    it('syncs to dismissed=true when another tab fires a storage event with a recent timestamp', () => {
        // Browsers fire `storage` events only in OTHER tabs than the one
        // that wrote the change, so this test simulates "tab B receives
        // a dismiss from tab A" by dispatching a synthetic StorageEvent.
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(false);

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: KEY,
                    newValue: String(Date.now()),
                }),
            );
        });

        expect(result.current.dismissed).toBe(true);
    });

    it('syncs to dismissed=false when another tab fires a storage event with a null newValue', () => {
        // null newValue is what the spec emits when localStorage.removeItem
        // is called in another tab.
        localStorage.setItem(KEY, String(Date.now()));
        const { result } = renderHook(() => useDismissalState(KEY));
        expect(result.current.dismissed).toBe(true);

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: KEY,
                    newValue: null,
                }),
            );
        });

        expect(result.current.dismissed).toBe(false);
    });

    it('ignores storage events for unrelated keys', () => {
        const { result } = renderHook(() => useDismissalState(KEY));

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'unrelated-key',
                    newValue: String(Date.now()),
                }),
            );
        });

        expect(result.current.dismissed).toBe(false);
    });

    it('treats a storage event carrying a stale timestamp as not-dismissed', () => {
        const { result } = renderHook(() => useDismissalState(KEY));

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: KEY,
                    newValue: String(Date.now() - DISMISS_DURATION_MS - 1),
                }),
            );
        });

        expect(result.current.dismissed).toBe(false);
    });
});
