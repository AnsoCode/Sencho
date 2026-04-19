import { useCallback, useEffect, useRef, useState } from 'react';

type CollapseMap = Record<string, boolean>;

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
  const [map, setMap] = useState<CollapseMap>(() => readMap(key));
  const skipNextWrite = useRef(true); // skip the initial mount write (state came from readMap)

  useEffect(() => {
    // Node changed: re-hydrate and skip the write that setMap would otherwise trigger.
    skipNextWrite.current = true;
    setMap(readMap(key));
  }, [key]);

  useEffect(() => {
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
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
    setMap(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }, []);

  const setCollapsed = useCallback((groupKey: string, collapsed: boolean) => {
    setMap(prev => ({ ...prev, [groupKey]: collapsed }));
  }, []);

  return { isCollapsed, toggle, setCollapsed };
}
