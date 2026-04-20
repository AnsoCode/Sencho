import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePinnedStacks } from '../usePinnedStacks';

const KEY = 'sencho:sidebar:pinned';

describe('usePinnedStacks', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns empty pinned list when no storage', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    expect(result.current.pinned).toEqual([]);
  });

  it('pin adds stack and persists to localStorage', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    act(() => result.current.pin('web.yml'));
    expect(result.current.pinned).toEqual(['web.yml']);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ '1': ['web.yml'] });
  });

  it('unpin removes stack', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    act(() => { result.current.pin('web.yml'); result.current.pin('db.yml'); });
    act(() => result.current.unpin('web.yml'));
    expect(result.current.pinned).toEqual(['db.yml']);
  });

  it('isPinned reports membership', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    act(() => result.current.pin('web.yml'));
    expect(result.current.isPinned('web.yml')).toBe(true);
    expect(result.current.isPinned('db.yml')).toBe(false);
  });

  it('evicts oldest when exceeding max of 10', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    act(() => {
      for (let i = 0; i < 10; i++) result.current.pin(`s${i}.yml`);
    });
    expect(result.current.pinned).toHaveLength(10);
    expect(result.current.evictedOldest).toBeNull();
    act(() => result.current.pin('s10.yml'));
    expect(result.current.pinned).toHaveLength(10);
    expect(result.current.pinned[0]).toBe('s1.yml');
    expect(result.current.pinned[9]).toBe('s10.yml');
    expect(result.current.evictedOldest).toEqual({ file: 's0.yml', seq: 1 });
  });

  it('evictedOldest seq increments on each eviction', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    act(() => {
      for (let i = 0; i < 10; i++) result.current.pin(`s${i}.yml`);
    });
    act(() => result.current.pin('s10.yml'));
    expect(result.current.evictedOldest).toEqual({ file: 's0.yml', seq: 1 });
    act(() => result.current.pin('s11.yml'));
    expect(result.current.evictedOldest).toEqual({ file: 's1.yml', seq: 2 });
  });

  it('isolates state per node', () => {
    const hookA = renderHook(() => usePinnedStacks(1));
    act(() => hookA.result.current.pin('web.yml'));
    const hookB = renderHook(() => usePinnedStacks(2));
    expect(hookB.result.current.pinned).toEqual([]);
  });

  it('pin is a no-op when already pinned', () => {
    const { result } = renderHook(() => usePinnedStacks(1));
    act(() => { result.current.pin('web.yml'); result.current.pin('web.yml'); });
    expect(result.current.pinned).toEqual(['web.yml']);
  });
});
