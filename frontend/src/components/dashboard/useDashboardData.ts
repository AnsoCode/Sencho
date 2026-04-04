import { useState, useEffect, useCallback, useRef } from 'react';
import { useNodes } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import type { Stats, SystemStats, MetricPoint, StackStatusEntry, DashboardData } from './types';

const DEFAULT_STATS: Stats = { active: 0, managed: 0, unmanaged: 0, exited: 0, total: 0 };

/**
 * Start a polling interval that pauses when the tab is hidden.
 * Returns a cleanup function that stops the interval.
 */
function visibilityInterval(fn: () => void, ms: number): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (interval) return;
    interval = setInterval(fn, ms);
  };

  const stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  const onVisChange = () => {
    if (document.hidden) {
      stop();
    } else {
      fn(); // Fetch immediately on re-focus
      start();
    }
  };

  document.addEventListener('visibilitychange', onVisChange);
  start();

  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisChange);
  };
}

export function useDashboardData(): DashboardData {
  const { activeNode } = useNodes();
  const nodeId = activeNode?.id;

  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [stackStatuses, setStackStatuses] = useState<Record<string, StackStatusEntry>>({});
  const [lastUpdated, setLastUpdated] = useState<number>(0);

  // Keep a ref to the latest nodeId so async callbacks don't write stale data
  // after a node switch has already triggered a new effect cycle.
  const nodeIdRef = useRef(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  const fetchJson = useCallback(async <T>(endpoint: string, options?: { localOnly?: boolean }): Promise<T | null> => {
    try {
      const res = await apiFetch(endpoint, options);
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }, []);

  // Container stats: 5s polling, resets on node change
  useEffect(() => {
    setStats(DEFAULT_STATS); // eslint-disable-line react-hooks/set-state-in-effect
    const currentNodeId = nodeId;
    const fetchStats = async () => {
      if (nodeIdRef.current !== currentNodeId) return; // Stale effect
      const data = await fetchJson<Stats>('/stats');
      if (data && nodeIdRef.current === currentNodeId) {
        setStats(data);
        setLastUpdated(Date.now());
      }
    };
    fetchStats();
    const cleanup = visibilityInterval(fetchStats, 5000);
    return cleanup;
  }, [nodeId, fetchJson]);

  // System stats: 5s polling, resets on node change
  useEffect(() => {
    setSystemStats(null); // eslint-disable-line react-hooks/set-state-in-effect
    const currentNodeId = nodeId;
    const fetchSys = async () => {
      if (nodeIdRef.current !== currentNodeId) return;
      const data = await fetchJson<SystemStats>('/system/stats');
      if (nodeIdRef.current === currentNodeId) {
        setSystemStats(data);
        if (data) setLastUpdated(Date.now());
      }
    };
    fetchSys();
    const cleanup = visibilityInterval(fetchSys, 5000);
    return cleanup;
  }, [nodeId, fetchJson]);

  // Historical metrics: 60s polling, resets on node change
  useEffect(() => {
    setMetrics([]); // eslint-disable-line react-hooks/set-state-in-effect
    const currentNodeId = nodeId;
    const fetchMetrics = async () => {
      if (nodeIdRef.current !== currentNodeId) return;
      const data = await fetchJson<MetricPoint[]>('/metrics/historical');
      if (data && nodeIdRef.current === currentNodeId) setMetrics(data);
    };
    fetchMetrics();
    const cleanup = visibilityInterval(fetchMetrics, 60000);
    return cleanup;
  }, [nodeId, fetchJson]);

  // Stack statuses: 10s polling, resets on node change
  useEffect(() => {
    setStackStatuses({}); // eslint-disable-line react-hooks/set-state-in-effect
    const currentNodeId = nodeId;
    const fetchStatuses = async () => {
      if (nodeIdRef.current !== currentNodeId) return;
      const data = await fetchJson<Record<string, StackStatusEntry>>('/stacks/statuses');
      if (data && nodeIdRef.current === currentNodeId) setStackStatuses(data);
    };
    fetchStatuses();
    const cleanup = visibilityInterval(fetchStatuses, 10000);
    return cleanup;
  }, [nodeId, fetchJson]);

  return { stats, systemStats, metrics, stackStatuses, lastUpdated };
}
