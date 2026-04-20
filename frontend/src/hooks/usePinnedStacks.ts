import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sencho:sidebar:pinned';
const MAX_PINS = 10;

type PinnedMap = Record<string, string[]>;

function readMap(): PinnedMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as PinnedMap : {};
  } catch {
    return {};
  }
}

function writeMap(map: PinnedMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exhaustion is non-fatal for this feature.
  }
}

export interface UsePinnedStacksResult {
  pinned: string[];
  pin: (file: string) => void;
  unpin: (file: string) => void;
  isPinned: (file: string) => boolean;
  evictedOldest: { file: string; seq: number } | null;
}

export function usePinnedStacks(nodeId: number | undefined): UsePinnedStacksResult {
  const key = nodeId !== undefined ? String(nodeId) : '__none__';
  const [map, setMap] = useState<PinnedMap>(() => readMap());
  const [evictedOldest, setEvictedOldest] = useState<{ file: string; seq: number } | null>(null);

  useEffect(() => { writeMap(map); }, [map]);

  const pinned = map[key] ?? [];

  const pin = useCallback((file: string) => {
    setMap(prev => {
      const current = prev[key] ?? [];
      if (current.includes(file)) return prev;
      const next = [...current, file];
      if (next.length > MAX_PINS) {
        const removed = next.shift()!;
        setEvictedOldest(prev => ({ file: removed, seq: (prev?.seq ?? 0) + 1 }));
      }
      return { ...prev, [key]: next };
    });
  }, [key]);

  const unpin = useCallback((file: string) => {
    setMap(prev => {
      const current = prev[key] ?? [];
      const next = current.filter(f => f !== file);
      if (next.length === current.length) return prev;
      return { ...prev, [key]: next };
    });
  }, [key]);

  const isPinned = useCallback((file: string) => pinned.includes(file), [pinned]);

  return { pinned, pin, unpin, isPinned, evictedOldest };
}
