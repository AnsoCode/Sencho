import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    setMap(readMap(key));
  }, [key]);

  useEffect(() => {
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
