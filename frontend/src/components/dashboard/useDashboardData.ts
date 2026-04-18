import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNodes } from '@/context/NodeContext';
import { apiFetch } from '@/lib/api';
import type {
  Stats,
  SystemStats,
  MetricPoint,
  StackStatusEntry,
  DashboardData,
  StackCpuSeries,
} from './types';

const DEFAULT_STATS: Stats = { active: 0, managed: 0, unmanaged: 0, exited: 0, total: 0 };
const SPARK_BUCKETS = 20;
const SPARK_WINDOW_MS = 10 * 60 * 1000;

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

function bucketCpu(points: MetricPoint[], windowMs: number, buckets: number): number[] {
  if (points.length === 0) return Array(buckets).fill(0);
  const now = Date.now();
  const start = now - windowMs;
  const bucketMs = windowMs / buckets;
  const out = Array<number>(buckets).fill(0);
  const counts = Array<number>(buckets).fill(0);
  for (const p of points) {
    if (p.timestamp < start) continue;
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((p.timestamp - start) / bucketMs)));
    out[idx] += p.cpu_percent;
    counts[idx] += 1;
  }
  for (let i = 0; i < buckets; i += 1) {
    if (counts[i] > 0) out[i] = out[i] / counts[i];
  }
  // Forward-fill empty buckets from the previous non-empty one so the line
  // reads as a continuous trend rather than a sawtooth of zeros.
  let last = 0;
  for (let i = 0; i < buckets; i += 1) {
    if (counts[i] === 0) out[i] = last;
    else last = out[i];
  }
  return out;
}

export function useDashboardData(): DashboardData {
  const { activeNode, nodes } = useNodes();
  const nodeId = activeNode?.id;

  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [stackStatuses, setStackStatuses] = useState<Record<string, StackStatusEntry>>({});
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

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
    setLastSyncAt(null);
    const currentNodeId = nodeId;
    const fetchStats = async () => {
      if (nodeIdRef.current !== currentNodeId) return; // Stale effect
      const data = await fetchJson<Stats>('/stats');
      if (data && nodeIdRef.current === currentNodeId) {
        setStats(data);
        setLastSyncAt(Date.now());
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

  const stackCpuSeries = useMemo<Record<string, StackCpuSeries>>(() => {
    if (metrics.length === 0) return {};
    const grouped = new Map<string, MetricPoint[]>();
    for (const point of metrics) {
      if (!point.stack_name) continue;
      const bucket = grouped.get(point.stack_name) ?? [];
      bucket.push(point);
      grouped.set(point.stack_name, bucket);
    }
    const out: Record<string, StackCpuSeries> = {};
    for (const [stackName, rows] of grouped) {
      const points = bucketCpu(rows, SPARK_WINDOW_MS, SPARK_BUCKETS);
      let peakValue = -Infinity;
      let peakIndex = 0;
      for (let i = 0; i < points.length; i += 1) {
        if (points[i] > peakValue) {
          peakValue = points[i];
          peakIndex = i;
        }
      }
      out[stackName] = {
        stackName,
        points,
        peakValue: peakValue === -Infinity ? 0 : peakValue,
        peakIndex,
        latestValue: points[points.length - 1] ?? 0,
      };
    }
    return out;
  }, [metrics]);

  const cores = systemStats?.cpu.cores || 1;

  // Anchor the 10-minute sparkline window to the newest metric sample so the
  // bucketing memos stay pure (calling Date.now() inside useMemo would violate
  // react-hooks/purity and could yield inconsistent bucket boundaries across
  // re-renders).
  const historyEndAt = useMemo<number | null>(() => {
    if (metrics.length === 0) return null;
    let max = metrics[0].timestamp;
    for (let i = 1; i < metrics.length; i += 1) {
      if (metrics[i].timestamp > max) max = metrics[i].timestamp;
    }
    return max;
  }, [metrics]);

  // Aggregate host-level CPU normalized over cores, so the sparkline matches
  // the gauge percentage rather than summing raw container usage.
  const cpuHistory = useMemo<number[]>(() => {
    if (metrics.length === 0 || historyEndAt === null) return Array(SPARK_BUCKETS).fill(0);
    const start = historyEndAt - SPARK_WINDOW_MS;
    const bucketMs = SPARK_WINDOW_MS / SPARK_BUCKETS;
    // Per-bucket sum across all containers, tracking how many distinct
    // timestamps contributed so we can average per bucket.
    const bucketSum = Array<number>(SPARK_BUCKETS).fill(0);
    const bucketTimestamps = Array.from({ length: SPARK_BUCKETS }, () => new Set<number>());
    for (const p of metrics) {
      if (p.timestamp < start) continue;
      const idx = Math.min(SPARK_BUCKETS - 1, Math.max(0, Math.floor((p.timestamp - start) / bucketMs)));
      bucketSum[idx] += p.cpu_percent / cores;
      bucketTimestamps[idx].add(p.timestamp);
    }
    const out = Array<number>(SPARK_BUCKETS).fill(0);
    let last = 0;
    for (let i = 0; i < SPARK_BUCKETS; i += 1) {
      const tsCount = bucketTimestamps[i].size;
      if (tsCount > 0) {
        out[i] = bucketSum[i] / tsCount;
        last = out[i];
      } else {
        out[i] = last;
      }
    }
    return out;
  }, [metrics, cores, historyEndAt]);

  // Network throughput over time: compute per-container deltas between
  // consecutive samples, assign each delta to the bucket of the later sample,
  // and sum across containers. This is robust to container churn because each
  // delta is paired within a single container's lifeline. Negative deltas
  // (counter reset after a restart) clamp to zero.
  const netHistory = useMemo<number[]>(() => {
    if (metrics.length === 0 || historyEndAt === null) return Array(SPARK_BUCKETS).fill(0);
    const start = historyEndAt - SPARK_WINDOW_MS;
    const bucketMs = SPARK_WINDOW_MS / SPARK_BUCKETS;
    const byContainer = new Map<string, MetricPoint[]>();
    for (const p of metrics) {
      const bucket = byContainer.get(p.container_id) ?? [];
      bucket.push(p);
      byContainer.set(p.container_id, bucket);
    }
    const out = Array<number>(SPARK_BUCKETS).fill(0);
    for (const samples of byContainer.values()) {
      samples.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 1; i < samples.length; i += 1) {
        const curr = samples[i];
        if (curr.timestamp < start) continue;
        const prev = samples[i - 1];
        const delta = (curr.net_rx_mb + curr.net_tx_mb) - (prev.net_rx_mb + prev.net_tx_mb);
        if (delta <= 0) continue;
        const idx = Math.min(SPARK_BUCKETS - 1, Math.max(0, Math.floor((curr.timestamp - start) / bucketMs)));
        out[idx] += delta;
      }
    }
    return out;
  }, [metrics, historyEndAt]);

  return {
    stats,
    systemStats,
    metrics,
    stackStatuses,
    lastSyncAt,
    nodeCount: nodes.length,
    stackCpuSeries,
    cpuHistory,
    netHistory,
    historyEndAt,
  };
}
