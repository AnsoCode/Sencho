import { useCallback } from 'react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { useLicense } from '@/context/LicenseContext';

export type BulkAction = 'start' | 'stop' | 'restart' | 'update';

const pastTense: Record<BulkAction, string> = {
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  update: 'updated',
};

interface BulkCallbacks {
  onBefore?: (files: string[]) => void;
  onAfter?: (files: string[]) => void;
}

export function useBulkStackActions() {
  const { isPaid } = useLicense();

  const runBulk = useCallback(async (
    action: BulkAction,
    files: string[],
    cbs?: BulkCallbacks,
  ) => {
    if (files.length === 0) return;
    if (action === 'update' && !isPaid) {
      toast.error('Bulk update requires a Skipper license.');
      return;
    }

    cbs?.onBefore?.(files);

    const results = await Promise.allSettled(
      files.map(file => {
        const stackName = file.replace(/\.(yml|yaml)$/, '');
        const headers: Record<string, string> = action === 'update' ? { 'x-bulk-mode': '1' } : {};
        return apiFetch(`/stacks/${encodeURIComponent(stackName)}/${action}`, {
          method: 'POST',
          headers,
        }).then(res => {
          if (!res.ok) return Promise.reject(new Error(file));
          return file;
        });
      })
    );

    cbs?.onAfter?.(files);

    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => (r.reason as Error).message);
    const okCount = results.length - failed.length;

    if (failed.length === 0) {
      const noun = okCount === 1 ? 'stack' : 'stacks';
      toast.success(`${okCount} ${noun} ${pastTense[action]}`);
    } else {
      toast.error(`${okCount} of ${files.length} ${pastTense[action]}; ${failed.length} failed: ${failed.join(', ')}`);
    }
  }, [isPaid]);

  return { runBulk, isPaid };
}
