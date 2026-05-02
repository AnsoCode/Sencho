import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

// Module-scope cache: read once at boot, do not invalidate. The
// SENCHO_EXPERIMENTAL flag is read from the gateway node's process
// env at request time, so it cannot flip mid-session without a
// restart. If the initial fetch fails the value sticks at false until
// a full reload; that is acceptable for a dev-only flag.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function fetchExperimental(): Promise<boolean> {
  if (cached !== null) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // localOnly: the flag is a property of the gateway running the
      // browser session, not of whichever remote node is currently
      // selected. Without this, switching nodes would re-evaluate the
      // flag against the wrong process env.
      const res = await apiFetch('/meta', { localOnly: true });
      if (!res.ok) {
        cached = false;
        return false;
      }
      const body = (await res.json()) as { experimental?: boolean };
      const next = body.experimental === true;
      cached = next;
      return next;
    } catch {
      cached = false;
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useExperimental(): boolean {
  const [value, setValue] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let active = true;
    fetchExperimental().then((next) => {
      if (active) setValue(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return value;
}
