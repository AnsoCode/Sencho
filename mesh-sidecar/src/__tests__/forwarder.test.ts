import net from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { Forwarder, MeshController } from '../forwarder';

interface RecordedCalls {
    resolve: Array<{ connId: number; port: number; remoteAddr: string }>;
    sendData: Array<{ streamId: number; payload: Buffer }>;
    sendClose: number[];
    sendStats: Array<{ streamId: number; bytesIn: number; bytesOut: number }>;
}

function makeRecordingController(): { controller: MeshController; calls: RecordedCalls } {
    const calls: RecordedCalls = { resolve: [], sendData: [], sendClose: [], sendStats: [] };
    const controller: MeshController = {
        resolve: (connId, port, remoteAddr) => calls.resolve.push({ connId, port, remoteAddr }),
        sendData: (streamId, payload) => calls.sendData.push({ streamId, payload: Buffer.from(payload) }),
        sendClose: (streamId) => calls.sendClose.push(streamId),
        sendStats: (streamId, bytesIn, bytesOut) => calls.sendStats.push({ streamId, bytesIn, bytesOut }),
    };
    return { controller, calls };
}

async function getEphemeralPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('no address'));
                return;
            }
            const port = addr.port;
            server.close(() => resolve(port));
        });
    });
}

async function dial(port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => resolve(socket));
        socket.once('error', reject);
    });
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 1000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = check();
        if (value !== undefined && value !== null && (Array.isArray(value) ? value.length > 0 : true)) {
            return value as T;
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout waiting for condition');
}

describe('Forwarder', () => {
    let forwarder: Forwarder | null = null;

    afterEach(async () => {
        if (forwarder) await forwarder.shutdown();
        forwarder = null;
    });

    it('asks the controller to resolve when a client connects', async () => {
        const { controller, calls } = makeRecordingController();
        forwarder = new Forwarder(controller);
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);

        const client = await dial(port);
        const resolved = await waitFor(() => calls.resolve.length ? calls.resolve : undefined);
        expect(resolved[0].port).toBe(port);
        expect(resolved[0].connId).toBeGreaterThan(0);

        client.destroy();
    });

    it('splices bytes both directions after resolve_ok', async () => {
        const { controller, calls } = makeRecordingController();
        forwarder = new Forwarder(controller);
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);

        const received: Buffer[] = [];
        const client = await dial(port);
        client.on('data', (chunk: Buffer) => received.push(chunk));

        const resolved = await waitFor(() => calls.resolve.length ? calls.resolve : undefined);
        const connId = resolved[0].connId;
        const streamId = 42;
        forwarder.handleResolveOk(connId, streamId, 'test.alias.sencho');

        client.write('hello');
        const sent = await waitFor(() => calls.sendData.length ? calls.sendData : undefined);
        expect(sent[0].streamId).toBe(streamId);
        expect(sent[0].payload.toString()).toBe('hello');

        forwarder.handleData(streamId, Buffer.from('hi back'));
        await waitFor(() => received.length ? received : undefined);
        expect(Buffer.concat(received).toString()).toBe('hi back');

        client.destroy();
    });

    it('sends a close frame when the client socket disconnects', async () => {
        const { controller, calls } = makeRecordingController();
        forwarder = new Forwarder(controller);
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);

        const client = await dial(port);
        const resolved = await waitFor(() => calls.resolve.length ? calls.resolve : undefined);
        forwarder.handleResolveOk(resolved[0].connId, 7);

        client.destroy();
        const closed = await waitFor(() => calls.sendClose.length ? calls.sendClose : undefined);
        expect(closed[0]).toBe(7);
    });

    it('drops the local socket on resolve_err', async () => {
        const { controller, calls } = makeRecordingController();
        forwarder = new Forwarder(controller);
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);

        const client = await dial(port);
        const closedPromise = new Promise<void>((resolve) => client.once('close', () => resolve()));
        const resolved = await waitFor(() => calls.resolve.length ? calls.resolve : undefined);

        forwarder.handleResolveErr(resolved[0].connId, 'tunnel_down');
        await closedPromise;
        // No data was ever piped, so no close frame sent for this connId.
        expect(calls.sendClose.length).toBe(0);
    });

    it('destroys the local socket on inbound close', async () => {
        const { controller, calls } = makeRecordingController();
        forwarder = new Forwarder(controller);
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);

        const client = await dial(port);
        const closedPromise = new Promise<void>((resolve) => client.once('close', () => resolve()));
        const resolved = await waitFor(() => calls.resolve.length ? calls.resolve : undefined);
        forwarder.handleResolveOk(resolved[0].connId, 11);

        forwarder.handleClose(11);
        await closedPromise;
    });

    it('refuses new connections during shutdown', async () => {
        const { controller } = makeRecordingController();
        forwarder = new Forwarder(controller);
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);
        await forwarder.shutdown();

        await expect(dial(port)).rejects.toThrow();
        forwarder = null;
    });

    it('emits stats for active streams when the timer fires', async () => {
        const { controller, calls } = makeRecordingController();
        forwarder = new Forwarder(controller, { statsIntervalMs: 50 });
        forwarder.start();
        const port = await getEphemeralPort();
        await forwarder.listen(port);

        const client = await dial(port);
        const resolved = await waitFor(() => calls.resolve.length ? calls.resolve : undefined);
        forwarder.handleResolveOk(resolved[0].connId, 99);

        client.write('x');

        const stats = await waitFor(() => calls.sendStats.length ? calls.sendStats : undefined, 1500);
        expect(stats[0].streamId).toBe(99);
        expect(stats[0].bytesOut).toBeGreaterThan(0);

        client.destroy();
    });
});
