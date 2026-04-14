/**
 * Unit tests for DockerEventManager.
 *
 * Verifies that:
 *   - Boot enumerates only local nodes and spawns one service each.
 *   - 'node-added' for a local node spawns a service.
 *   - 'node-added' for a remote node does nothing.
 *   - 'node-removed' tears down the matching service.
 *   - 'node-updated' respawns when type flips remote <-> local.
 *   - Stop unsubscribes and tears down all services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Hoisted mocks ──────────────────────────────────────────────────────
// Note: the hoisted factory runs before imports, so we require `events`
// inline rather than referencing the top-level EventEmitter import.

const {
    mockGetNodes,
    mockGetNode,
    serviceStart,
    serviceShutdown,
    DockerEventServiceCtor,
    registryInstance,
} = vi.hoisted(() => {
    const { EventEmitter: HoistedEE } = require('events');
    const start = vi.fn().mockResolvedValue(undefined);
    const shutdown = vi.fn();
    // A real class (not a vi.fn) so `new` works reliably across vitest versions.
    class FakeDockerEventService {
        public readonly nodeId: number;
        public readonly nodeName: string;
        constructor(nodeId: number, nodeName: string) {
            this.nodeId = nodeId;
            this.nodeName = nodeName;
        }
        start() { return start(); }
        shutdown() { shutdown(); }
        getStatus() {
            return {
                nodeId: this.nodeId,
                nodeName: this.nodeName,
                status: 'connected' as const,
                reconnectAttempts: 0,
                trackedContainers: 0,
            };
        }
    }
    const ctorSpy = vi.fn((nodeId: number, nodeName: string) =>
        new FakeDockerEventService(nodeId, nodeName),
    );
    // Wrap in a Proxy so `new Ctor(...)` both constructs via the real class
    // and records the call on the spy for assertions.
    const Ctor = new Proxy(FakeDockerEventService, {
        construct(_target, args: [number, string]) {
            ctorSpy(...args);
            return new FakeDockerEventService(...args);
        },
    });
    return {
        mockGetNodes: vi.fn(),
        mockGetNode: vi.fn(),
        serviceStart: start,
        serviceShutdown: shutdown,
        DockerEventServiceCtor: Object.assign(Ctor, { _spy: ctorSpy }),
        registryInstance: new HoistedEE() as EventEmitter,
    };
});

vi.mock('../services/DatabaseService', () => ({
    DatabaseService: {
        getInstance: () => ({
            getNodes: mockGetNodes,
            getNode: mockGetNode,
        }),
    },
}));

vi.mock('../services/NodeRegistry', () => ({
    NodeRegistry: {
        getInstance: () => registryInstance,
    },
}));

vi.mock('../services/DockerEventService', () => ({
    DockerEventService: DockerEventServiceCtor,
}));

import { DockerEventManager } from '../services/DockerEventManager';

// Proxy records constructor calls on _spy for assertions.
const ctorSpy = (DockerEventServiceCtor as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;

beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton between tests.
    (DockerEventManager as unknown as { instance: DockerEventManager | undefined }).instance = undefined;
    registryInstance.removeAllListeners();
});

afterEach(() => {
    DockerEventManager.getInstance().stop();
});

describe('DockerEventManager - boot', () => {
    it('spawns a service for each local node and skips remote nodes', async () => {
        mockGetNodes.mockReturnValue([
            { id: 1, name: 'local-a', type: 'local' },
            { id: 2, name: 'remote-b', type: 'remote' },
            { id: 3, name: 'local-c', type: 'local' },
        ]);

        await DockerEventManager.getInstance().start();

        expect(ctorSpy).toHaveBeenCalledTimes(2);
        expect(ctorSpy).toHaveBeenCalledWith(1, 'local-a');
        expect(ctorSpy).toHaveBeenCalledWith(3, 'local-c');
        expect(serviceStart).toHaveBeenCalledTimes(2);
    });

    it('second start is a no-op', async () => {
        mockGetNodes.mockReturnValue([{ id: 1, name: 'a', type: 'local' }]);

        const mgr = DockerEventManager.getInstance();
        await mgr.start();
        await mgr.start();

        expect(ctorSpy).toHaveBeenCalledTimes(1);
    });
});

describe('DockerEventManager - node lifecycle events', () => {
    it('spawns a service when a local node is added', async () => {
        mockGetNodes.mockReturnValue([]);
        await DockerEventManager.getInstance().start();

        mockGetNode.mockReturnValue({ id: 5, name: 'new-local', type: 'local' });
        registryInstance.emit('node-added', 5);
        await vi.waitFor(() => expect(serviceStart).toHaveBeenCalled());

        expect(ctorSpy).toHaveBeenCalledWith(5, 'new-local');
    });

    it('does nothing when a remote node is added', async () => {
        mockGetNodes.mockReturnValue([]);
        await DockerEventManager.getInstance().start();

        mockGetNode.mockReturnValue({ id: 6, name: 'new-remote', type: 'remote' });
        registryInstance.emit('node-added', 6);
        // Give the async handler a tick to run.
        await new Promise(r => setTimeout(r, 0));

        expect(ctorSpy).not.toHaveBeenCalled();
    });

    it('shuts down the service when a node is removed', async () => {
        mockGetNodes.mockReturnValue([{ id: 7, name: 'to-remove', type: 'local' }]);
        await DockerEventManager.getInstance().start();
        expect(ctorSpy).toHaveBeenCalledTimes(1);

        registryInstance.emit('node-removed', 7);
        expect(serviceShutdown).toHaveBeenCalledTimes(1);
    });

    it('respawns when a remote node becomes local', async () => {
        mockGetNodes.mockReturnValue([]); // starts with nothing
        await DockerEventManager.getInstance().start();

        // Now the node exists and is local.
        mockGetNode.mockReturnValue({ id: 9, name: 'flipped', type: 'local' });
        registryInstance.emit('node-updated', 9);
        await vi.waitFor(() => expect(serviceStart).toHaveBeenCalled());

        expect(ctorSpy).toHaveBeenCalledWith(9, 'flipped');
    });

    it('tears down when a local node becomes remote', async () => {
        mockGetNodes.mockReturnValue([{ id: 10, name: 'was-local', type: 'local' }]);
        await DockerEventManager.getInstance().start();
        expect(ctorSpy).toHaveBeenCalledTimes(1);

        mockGetNode.mockReturnValue({ id: 10, name: 'was-local', type: 'remote' });
        registryInstance.emit('node-updated', 10);
        await new Promise(r => setTimeout(r, 0));

        expect(serviceShutdown).toHaveBeenCalledTimes(1);
    });
});

describe('DockerEventManager - shutdown', () => {
    it('stops every service and removes listeners', async () => {
        mockGetNodes.mockReturnValue([
            { id: 1, name: 'a', type: 'local' },
            { id: 2, name: 'b', type: 'local' },
        ]);
        const mgr = DockerEventManager.getInstance();
        await mgr.start();

        mgr.stop();

        expect(serviceShutdown).toHaveBeenCalledTimes(2);
        expect(registryInstance.listenerCount('node-added')).toBe(0);
        expect(registryInstance.listenerCount('node-removed')).toBe(0);
        expect(registryInstance.listenerCount('node-updated')).toBe(0);
    });
});
