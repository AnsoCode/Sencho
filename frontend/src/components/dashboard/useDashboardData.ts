import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Track nodeId to detect changes for clearing stale data
  const prevNodeRef = useRef(nodeId);

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
    const nodeChanged = prevNodeRef.current !== nodeId;
    if (nodeChanged) prevNodeRef.current = nodeId;

    const fetchStats = async () => {
      if (nodeChanged) setStats(DEFAULT_STATS);
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
    const fetchMetrics = async () => {
      const data = await fetchJson<MetricPoint[]>('/metrics/historical');
      setMetrics(data || []);
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000);
    return () => clearInterval(interval);
  }, [nodeId, fetchJson]);

  // Stack statuses: 10s polling, resets on node change
  useEffect(() => {
    const fetchStatuses = async () => {
      const data = await fetchJson<Record<string, StackStatusEntry>>('/stacks/statuses');
      setStackStatuses(data || {});
    };
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 10000);
    return () => clearInterval(interval);
  }, [nodeId, fetchJson]);

  // Notifications: 30s polling, local-only (not affected by node switch)
  useEffect(() => {
    const fetchNotifs = async () => {
      const data = await fetchJson<NotificationItem[]>('/notifications', { localOnly: true });
      if (data) setNotifications(data);
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 30000);
    return () => clearInterval(interval);
  }, [fetchJson]);

  return { stats, systemStats, metrics, stackStatuses, notifications, lastUpdated };
}
