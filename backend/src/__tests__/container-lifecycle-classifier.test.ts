/**
 * Unit tests for ContainerLifecycleClassifier.
 *
 * Pure function tests: no I/O, no mocks, no timers. The classifier is the
 * single source of truth for crash/intentional/clean/oom classification,
 * so these tests pin its behaviour contract.
 */
import { describe, it, expect } from 'vitest';
import {
    classifyDie,
    classifyGapExit,
    INTENTIONAL_KILL_WINDOW_MS,
} from '../services/ContainerLifecycleClassifier';

describe('classifyDie', () => {
    const now = 1_700_000_000_000;

    it('classifies as intentional when kill was recent', () => {
        const result = classifyDie(
            { at: now, exitCode: 1 },
            { lastKillAt: now - 1_000 },
        );
        expect(result).toBe('intentional');
    });

    it('classifies as intentional at exactly the boundary', () => {
        const result = classifyDie(
            { at: now, exitCode: 137 },
            { lastKillAt: now - INTENTIONAL_KILL_WINDOW_MS },
        );
        expect(result).toBe('intentional');
    });

    it('classifies as crash when kill was outside the window', () => {
        const result = classifyDie(
            { at: now, exitCode: 1 },
            { lastKillAt: now - (INTENTIONAL_KILL_WINDOW_MS + 1) },
        );
        expect(result).toBe('crash');
    });

    it('classifies as clean when exit code is 0 with no kill', () => {
        const result = classifyDie({ at: now, exitCode: 0 }, {});
        expect(result).toBe('clean');
    });

    it('classifies as crash when exit code is non-zero with no kill', () => {
        const result = classifyDie({ at: now, exitCode: 1 }, {});
        expect(result).toBe('crash');
    });

    it('classifies as crash when exit code is undefined (malformed)', () => {
        const result = classifyDie({ at: now, exitCode: undefined }, {});
        expect(result).toBe('crash');
    });

    it('classifies as oom when oomPending is true, overriding exit code', () => {
        const result = classifyDie(
            { at: now, exitCode: 0 },
            { oomPending: true },
        );
        expect(result).toBe('oom');
    });

    it('oom takes priority over a recent kill', () => {
        const result = classifyDie(
            { at: now, exitCode: 137 },
            { oomPending: true, lastKillAt: now - 1_000 },
        );
        expect(result).toBe('oom');
    });

    it('accepts a kill arriving slightly after the die (out-of-order delivery)', () => {
        // DockerEventService's 500ms grace window means the kill can land
        // after the die. The classifier treats that as intentional.
        const result = classifyDie(
            { at: now, exitCode: 1 },
            { lastKillAt: now + 200 },
        );
        expect(result).toBe('intentional');
    });

    it('treats a kill far outside the window (either direction) as crash', () => {
        const result = classifyDie(
            { at: now, exitCode: 1 },
            { lastKillAt: now + (INTENTIONAL_KILL_WINDOW_MS + 1) },
        );
        expect(result).toBe('crash');
    });
});

describe('classifyGapExit', () => {
    it('classifies OOMKilled containers as oom', () => {
        expect(classifyGapExit({ State: { OOMKilled: true, ExitCode: 137 } })).toBe('oom');
    });

    it('classifies exit code 0 as clean', () => {
        expect(classifyGapExit({ State: { OOMKilled: false, ExitCode: 0 } })).toBe('clean');
    });

    it('classifies non-zero exit code as crash', () => {
        expect(classifyGapExit({ State: { OOMKilled: false, ExitCode: 1 } })).toBe('crash');
    });

    it('handles missing State gracefully', () => {
        expect(classifyGapExit({})).toBe('crash');
    });

    it('handles undefined exit code as crash', () => {
        expect(classifyGapExit({ State: {} })).toBe('crash');
    });
});
