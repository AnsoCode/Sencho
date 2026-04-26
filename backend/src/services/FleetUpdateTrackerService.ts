export interface UpdateTracker {
  status: 'updating' | 'completed' | 'timeout' | 'failed';
  startedAt: number;
  previousVersion: string | null;
  error?: string;
  /** Process start time of the remote node before the update was triggered. */
  previousProcessStart: number | null;
  /** True when the node became unreachable at least once during the update window. */
  wasOffline: boolean;
  /** Timestamp when the tracker transitioned to a terminal state (completed/failed/timeout). */
  resolvedAt?: number;
}

export type TerminalStatus = 'completed' | 'failed' | 'timeout';

/**
 * In-memory tracker for in-flight fleet node updates. Keyed by node id.
 *
 * State is intentionally process-local: a restart clears all trackers, which
 * is correct because the primary's own restart means it cannot observe remote
 * update progress anyway. Fleet routes consume this service to render and
 * clear update status.
 */
export class FleetUpdateTrackerService {
  private static instance: FleetUpdateTrackerService;
  private readonly trackers = new Map<number, UpdateTracker>();

  public static getInstance(): FleetUpdateTrackerService {
    if (!FleetUpdateTrackerService.instance) {
      FleetUpdateTrackerService.instance = new FleetUpdateTrackerService();
    }
    return FleetUpdateTrackerService.instance;
  }

  public get(nodeId: number): UpdateTracker | undefined {
    return this.trackers.get(nodeId);
  }

  public set(nodeId: number, tracker: UpdateTracker): void {
    this.trackers.set(nodeId, tracker);
  }

  public delete(nodeId: number): boolean {
    return this.trackers.delete(nodeId);
  }

  public entries(): IterableIterator<[number, UpdateTracker]> {
    return this.trackers.entries();
  }

  public size(): number {
    return this.trackers.size;
  }

  /** Create a new tracker with `startedAt=now` and resolvedAt set if terminal. */
  public create(
    status: UpdateTracker['status'],
    previousVersion: string | null,
    previousProcessStart: number | null,
    error?: string,
  ): UpdateTracker {
    const now = Date.now();
    return {
      status,
      startedAt: now,
      previousVersion,
      previousProcessStart,
      wasOffline: false,
      error,
      resolvedAt: status !== 'updating' ? now : undefined,
    };
  }

  /** Return a copy of `tracker` transitioned to a terminal state, with resolvedAt=now. */
  public resolve(tracker: UpdateTracker, status: TerminalStatus, error?: string): UpdateTracker {
    return { ...tracker, status, resolvedAt: Date.now(), error };
  }
}
