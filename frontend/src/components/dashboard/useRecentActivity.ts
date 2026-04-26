import { useState, useEffect, useCallback, useRef } from 'react';
import { useNodes } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import { visibilityInterval } from '@/lib/utils';

export interface ActivityItem {
  id: number;
  level: 'info' | 'warning' | 'error';
  category?: string;
  message: string;
  timestamp: number;
  is_read: boolean;
  stack_name?: string;
  container_name?: string;
}

export function useRecentActivity(limit = 10) {
  const { activeNode } = useNodes();
  const nodeId = activeNode?.id;
  const nodeIdRef = useRef(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await apiFetch(`/dashboard/recent-activity?limit=${limit}`);
      if (!res.ok) return;
      const data = await res.json() as ActivityItem[];
      setItems(data);
    } catch {
      // Silent; stale data stays
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    setItems([]);
    setLoading(true);
    const currentNodeId = nodeId;
    const guard = () => { if (nodeIdRef.current === currentNodeId) void fetchActivity(); };
    guard();
    return visibilityInterval(guard, 30_000);
  }, [nodeId, fetchActivity]);

  useEffect(() => {
    const handler = () => void fetchActivity();
    window.addEventListener('sencho:state-invalidate', handler);
    return () => window.removeEventListener('sencho:state-invalidate', handler);
  }, [fetchActivity]);

  return { items, loading };
}
