import { useEffect, useRef } from 'react';
import type { NodeUpdateStatus } from '../types';

interface UseFleetPollingOptions {
    isPaid: boolean;
    fetchOverview: () => Promise<void> | void;
    fetchUpdateStatus: () => Promise<void> | void;
    updateStatuses: NodeUpdateStatus[];
}

export function useFleetPolling({
    isPaid,
    fetchOverview,
    fetchUpdateStatus,
    updateStatuses,
}: UseFleetPollingOptions): void {
    useEffect(() => {
        fetchOverview();
        fetchUpdateStatus();
    }, [fetchOverview, fetchUpdateStatus]);

    // Paid tier: auto-refresh every 30s
    useEffect(() => {
        if (!isPaid) return;
        const overviewInterval = setInterval(fetchOverview, 30000);
        const updateInterval = setInterval(fetchUpdateStatus, 120000);
        return () => { clearInterval(overviewInterval); clearInterval(updateInterval); };
    }, [isPaid, fetchOverview, fetchUpdateStatus]);

    // Fast poll (5s) when any node is actively updating. Uses ref to avoid interval thrashing.
    const hasUpdatingRef = useRef(false);
    useEffect(() => {
        hasUpdatingRef.current = updateStatuses.some(s => s.updateStatus === 'updating');
    }, [updateStatuses]);

    useEffect(() => {
        const id = setInterval(() => {
            if (hasUpdatingRef.current) {
                fetchUpdateStatus();
                fetchOverview();
            }
        }, 5000);
        return () => clearInterval(id);
    }, [fetchUpdateStatus, fetchOverview]);
}
