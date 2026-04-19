import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarGroupCollapse } from '../useSidebarGroupCollapse';

describe('useSidebarGroupCollapse', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to expanded (isCollapsed returns false)', () => {
    const { result } = renderHook(() => useSidebarGroupCollapse(1));
    expect(result.current.isCollapsed('prod')).toBe(false);
  });

  it('toggle flips state and persists', () => {
    const { result } = renderHook(() => useSidebarGroupCollapse(1));
    act(() => result.current.toggle('prod'));
    expect(result.current.isCollapsed('prod')).toBe(true);
    const raw = window.localStorage.getItem('sencho:sidebar:groups:1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ prod: true });
  });

  it('toggle twice returns to expanded', () => {
    const { result } = renderHook(() => useSidebarGroupCollapse(1));
    act(() => { result.current.toggle('prod'); result.current.toggle('prod'); });
    expect(result.current.isCollapsed('prod')).toBe(false);
  });

  it('keys state per node', () => {
    const a = renderHook(() => useSidebarGroupCollapse(1));
    act(() => a.result.current.toggle('prod'));
    const b = renderHook(() => useSidebarGroupCollapse(2));
    expect(b.result.current.isCollapsed('prod')).toBe(false);
  });

  it('restores state from localStorage on mount', () => {
    window.localStorage.setItem('sencho:sidebar:groups:1', JSON.stringify({ prod: true }));
    const { result } = renderHook(() => useSidebarGroupCollapse(1));
    expect(result.current.isCollapsed('prod')).toBe(true);
  });
});
