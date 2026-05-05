import { useState, useEffect, useCallback, useRef } from 'react';
import { useNodes } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import { visibilityInterval } from '@/lib/utils';

export interface StackRestartSummary {
  stackName: string;
  crash: number;
  autoheal: number;
  manual: number;
  total: number;
}

export interface StackRestartMapResult {
  restarts: StackRestartSummary[];
  loading: boolean;
  error: string | null;
}

export function useStackRestartMap(): StackRestartMapResult {
  const { activeNode } = useNodes();
  const nodeId = activeNode?.id;
  const nodeIdRef = useRef(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  const [restarts, setRestarts] = useState<StackRestartSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRestarts = useCallback(async () => {
    try {
      const res = await apiFetch('/dashboard/stack-restarts?days=7');
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? 'Failed to load restart data');
        return;
      }
      const data = await res.json() as StackRestartSummary[];
      setRestarts(data);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load restart data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setRestarts([]); // eslint-disable-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const currentNodeId = nodeId;
    const guard = () => {
      if (nodeIdRef.current === currentNodeId) {
        void fetchRestarts();
      }
    };
    guard();
    return visibilityInterval(guard, 300_000);
  }, [nodeId, fetchRestarts]);

  return { restarts, loading, error };
}
