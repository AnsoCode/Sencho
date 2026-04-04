import { useState, useEffect, useCallback } from 'react';
import { useNodes } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import type { Stats, SystemStats, MetricPoint, NotificationItem, StackStatusEntry, DashboardData } from './types';

const DEFAULT_STATS: Stats = { active: 0, managed: 0, unmanaged: 0, exited: 0, total: 0 };

export function useDashboardData(): DashboardData {
  const { activeNode } = useNodes();
  const nodeId = activeNode?.id;

  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [stackStatuses, setStackStatuses] = useState<Record<string, StackStatusEntry>>({});
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number>(0);

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
    // Reset stale data immediately, then fetch fresh data for the new node.
    // The cleanup function from the previous effect run already cleared the old interval,
    // so the reset only happens once per node switch, not on every poll tick.
    setStats(DEFAULT_STATS); // eslint-disable-line react-hooks/set-state-in-effect
    const fetchStats = async () => {
      const data = await fetchJson<Stats>('/stats');
      if (data) {
        setStats(data);
        setLastUpdated(Date.now());
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [nodeId, fetchJson]);

  // System stats: 5s polling, resets on node change
  useEffect(() => {
    setSystemStats(null); // eslint-disable-line react-hooks/set-state-in-effect
    const fetchSys = async () => {
      const data = await fetchJson<SystemStats>('/system/stats');
      if (data) {
        setSystemStats(data);
        setLastUpdated(Date.now());
      } else {
        setSystemStats(null);
      }
    };
    fetchSys();
    const interval = setInterval(fetchSys, 5000);
    return () => clearInterval(interval);
  }, [nodeId, fetchJson]);

  // Historical metrics: 60s polling, resets on node change
  useEffect(() => {
    setMetrics([]); // eslint-disable-line react-hooks/set-state-in-effect
    const fetchMetrics = async () => {
      const data = await fetchJson<MetricPoint[]>('/metrics/historical');
      if (data) setMetrics(data);
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, [nodeId, fetchJson]);

  // Stack statuses: 10s polling, resets on node change
  useEffect(() => {
    setStackStatuses({}); // eslint-disable-line react-hooks/set-state-in-effect
    const fetchStatuses = async () => {
      const data = await fetchJson<Record<string, StackStatusEntry>>('/stacks/statuses');
      if (data) setStackStatuses(data);
    };
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 10000);
    return () => clearInterval(interval);
  }, [nodeId, fetchJson]);

  const refreshNotifications = useCallback(async () => {
    const data = await fetchJson<NotificationItem[]>('/notifications', { localOnly: true });
    if (data) setNotifications(data);
  }, [fetchJson]);

  // Notifications: 30s polling, local-only (not affected by node switch)
  useEffect(() => {
    const poll = async () => {
      const data = await fetchJson<NotificationItem[]>('/notifications', { localOnly: true });
      if (data) setNotifications(data);
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [fetchJson]);

  return { stats, systemStats, metrics, stackStatuses, notifications, lastUpdated, refreshNotifications };
}
