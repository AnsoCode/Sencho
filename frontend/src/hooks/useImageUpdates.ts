import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api';

const IMAGE_UPDATE_POLL_MS = 5 * 60 * 1000;

/**
 * Owns the stack-image-update state and its 5-minute background poll.
 * Re-fetches whenever `activeNodeId` changes; consumers can also call
 * `refresh()` to force a refetch (e.g. after a deploy or a manual
 * registry-check trigger).
 *
 * Extracted from EditorLayout so the polling lifecycle and its state
 * live next to each other instead of being spread across a 3000-line
 * component. The dependency on `apiFetch` keeps the call routed
 * through the active-node header just like before.
 */
export function useImageUpdates(activeNodeId: number | undefined) {
  const [stackUpdates, setStackUpdates] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/image-updates');
      if (res.ok) {
        const data = await res.json() as Record<string, boolean>;
        setStackUpdates(data);
      }
    } catch (e: unknown) {
      console.error('[ImageUpdates] fetch failed:', e);
    }
  }, []);

  // Pin the interval to the latest closure without retriggering it on
  // every render the way putting `refresh` into the deps array would.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    const id = setInterval(() => { void refreshRef.current(); }, IMAGE_UPDATE_POLL_MS);
    return () => clearInterval(id);
  }, [activeNodeId]);

  return { stackUpdates, refresh };
}
