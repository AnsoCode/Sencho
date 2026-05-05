import { useState, useEffect, useCallback, useRef } from 'react';
import { useNodes } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import { visibilityInterval } from '@/lib/utils';

export interface FleetNodeOverview {
  id: number;
  name: string;
  type: 'local' | 'remote';
  status: 'online' | 'offline' | 'unknown';
  stats: {
    active: number;
    managed: number;
    unmanaged: number;
    exited: number;
    total: number;
  } | null;
  latency_ms?: number;
  last_successful_contact?: number | null;
}

export interface FleetHeartbeatResult {
  nodes: FleetNodeOverview[];
  loading: boolean;
  error: string | null;
}

export function useFleetHeartbeat(): FleetHeartbeatResult {
  const { activeNode } = useNodes();
  const nodeId = activeNode?.id;
  const nodeIdRef = useRef(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  const [nodes, setNodes] = useState<FleetNodeOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await apiFetch('/fleet/overview', { localOnly: true });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Failed to load fleet overview');
        return;
      }
      const data = await res.json() as FleetNodeOverview[];
      setNodes(data);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load fleet overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNodes([]); // eslint-disable-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const currentNodeId = nodeId;
    const guard = () => {
      if (nodeIdRef.current === currentNodeId) {
        void fetchOverview();
      }
    };
    guard();
    return visibilityInterval(guard, 30_000);
  }, [nodeId, fetchOverview]);

  return { nodes, loading, error };
}
