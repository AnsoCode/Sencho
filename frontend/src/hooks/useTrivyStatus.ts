import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { TrivyStatus } from '@/types/security';

export function useTrivyStatus(): TrivyStatus {
  const [status, setStatus] = useState<TrivyStatus>({ available: false, version: null });

  useEffect(() => {
    let cancelled = false;
    apiFetch('/security/trivy-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setStatus({
          available: !!d.available,
          version: typeof d.version === 'string' ? d.version : null,
        });
      })
      .catch((err) => {
        console.error('Failed to fetch Trivy status:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
