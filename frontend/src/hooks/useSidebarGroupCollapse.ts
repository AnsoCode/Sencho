import { useCallback, useEffect, useRef, useState } from 'react';

type CollapseMap = Record<string, boolean>;

interface CollapseState {
  key: string;
  map: CollapseMap;
}

function storageKey(nodeId: number | undefined): string {
  return `sencho:sidebar:groups:${nodeId ?? '__none__'}`;
}

function readMap(key: string): CollapseMap {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as CollapseMap : {};
  } catch {
    return {};
  }
}

export interface UseSidebarGroupCollapseResult {
  isCollapsed: (groupKey: string) => boolean;
  toggle: (groupKey: string) => void;
  setCollapsed: (groupKey: string, collapsed: boolean) => void;
}

export function useSidebarGroupCollapse(nodeId: number | undefined): UseSidebarGroupCollapseResult {
  const key = storageKey(nodeId);
  const [state, setState] = useState<CollapseState>(() => ({ key, map: readMap(key) }));

  if (state.key !== key) {
    // Node changed: re-hydrate during render (derived state pattern).
    setState({ key, map: readMap(key) });
  }

  const map = state.map;
  const lastWrittenKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastWrittenKey.current !== key) {
      // First sighting of this key (mount or node change): state was hydrated from storage; no write needed.
      lastWrittenKey.current = key;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(map));
    } catch {
      // Ignore quota errors.
    }
  }, [key, map]);

  const isCollapsed = useCallback((groupKey: string) => map[groupKey] === true, [map]);

  const toggle = useCallback((groupKey: string) => {
    setState(prev => ({ key: prev.key, map: { ...prev.map, [groupKey]: !prev.map[groupKey] } }));
  }, []);

  const setCollapsed = useCallback((groupKey: string, collapsed: boolean) => {
    setState(prev => ({ key: prev.key, map: { ...prev.map, [groupKey]: collapsed } }));
  }, []);

  return { isCollapsed, toggle, setCollapsed };
}
