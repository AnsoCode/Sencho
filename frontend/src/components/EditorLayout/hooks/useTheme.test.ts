import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTheme } from './useTheme';

const mockMatchMedia = (matches: boolean) => {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  return {
    matches,
    addEventListener: vi.fn((_: string, cb: (e: MediaQueryListEvent) => void) => { listeners.push(cb); }),
    removeEventListener: vi.fn(),
    _trigger: (m: boolean) => listeners.forEach(cb => cb({ matches: m } as MediaQueryListEvent)),
  };
};

describe('useTheme', () => {
  let mq: ReturnType<typeof mockMatchMedia>;

  beforeEach(() => {
    localStorage.clear();
    mq = mockMatchMedia(false);
    vi.stubGlobal('matchMedia', vi.fn(() => mq));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to dark theme when no localStorage entry', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.isDarkMode).toBe(true);
  });

  it('reads persisted theme from localStorage', () => {
    localStorage.setItem('sencho-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.isDarkMode).toBe(false);
  });

  it('setTheme persists to localStorage and updates isDarkMode', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(result.current.isDarkMode).toBe(false);
    expect(localStorage.getItem('sencho-theme')).toBe('light');
  });

  it('auto theme tracks system preference', () => {
    mq = mockMatchMedia(true);
    vi.stubGlobal('matchMedia', vi.fn(() => mq));
    localStorage.setItem('sencho-theme', 'auto');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDarkMode).toBe(true);
  });

  it('applies dark class to documentElement when isDarkMode', () => {
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class when switching to light', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
