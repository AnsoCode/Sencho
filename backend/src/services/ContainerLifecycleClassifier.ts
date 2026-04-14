/**
 * ContainerLifecycleClassifier
 *
 * Pure classification helpers for Docker container lifecycle events. No I/O,
 * no side effects, no singletons. Consumed by DockerEventService.
 *
 * The classifier answers a single question: given a `die` event and the
 * container's recent lifecycle state, is this exit intentional, a clean exit,
 * an OOM kill, or a crash worth alerting on?
 */

export type Classification = 'intentional' | 'clean' | 'crash' | 'oom';

/** Window (ms) after a `kill` event within which a subsequent `die` is considered intentional. */
export const INTENTIONAL_KILL_WINDOW_MS = 60_000;

export interface ContainerLifecycleState {
    /** Timestamp (ms) of the most recent `kill` event for this container, if any. */
    lastKillAt?: number;
    /** True when an `oom` event has been observed and the matching `die` has not yet arrived. */
    oomPending?: boolean;
}

export interface DieEventInput {
    /** Time the die event occurred (ms). Typically Date.now() when the event was parsed. */
    at: number;
    /** Exit code reported by Docker. May be undefined for malformed events (treated as non-zero). */
    exitCode: number | undefined;
}

/**
 * Classify a die event against the container's current lifecycle state.
 *
 * Priority order:
 *   1. OOM pending → 'oom' (OOM kills are meaningful even if exitCode looks clean)
 *   2. Recent kill within window → 'intentional'
 *   3. Exit code 0 → 'clean'
 *   4. Anything else → 'crash'
 */
export function classifyDie(
    input: DieEventInput,
    state: ContainerLifecycleState,
): Classification {
    if (state.oomPending) return 'oom';

    if (typeof state.lastKillAt === 'number') {
        // Use absolute age so out-of-order deliveries (kill arrives slightly
        // after die) still classify as intentional. DockerEventService's 500ms
        // die grace window makes this realistically bounded.
        const age = Math.abs(input.at - state.lastKillAt);
        if (age <= INTENTIONAL_KILL_WINDOW_MS) {
            return 'intentional';
        }
    }

    if (input.exitCode === 0) return 'clean';
    return 'crash';
}

/**
 * Classify a gap exit discovered during reconciliation (no die event observed
 * because the stream was disconnected). Uses the container inspect result
 * rather than event state.
 */
export function classifyGapExit(inspect: {
    State?: { OOMKilled?: boolean; ExitCode?: number };
}): Classification {
    const oom = inspect.State?.OOMKilled === true;
    if (oom) return 'oom';
    const code = inspect.State?.ExitCode;
    if (code === 0) return 'clean';
    return 'crash';
}
