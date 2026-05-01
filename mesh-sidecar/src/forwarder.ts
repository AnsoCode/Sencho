import net from 'net';

const DEFAULT_STATS_INTERVAL_MS = 5_000;

export interface ForwarderOptions {
    statsIntervalMs?: number;
}

/**
 * Outbound channel to the Sencho instance hosting this sidecar. The
 * production implementation is the control WS client; tests inject a fake.
 */
export interface MeshController {
    resolve(connId: number, port: number, remoteAddr: string): void;
    sendData(streamId: number, payload: Buffer): void;
    sendClose(streamId: number): void;
    sendStats(streamId: number, bytesIn: number, bytesOut: number, lastActivity: number): void;
}

interface PendingConn {
    connId: number;
    socket: net.Socket;
    port: number;
}

interface ActiveStream {
    streamId: number;
    socket: net.Socket;
    bytesIn: number;
    bytesOut: number;
    lastActivity: number;
    alias?: string;
}

/**
 * The Forwarder owns per-port TCP listeners and the live socket <-> stream
 * mapping. It is wire-agnostic: all outbound frames flow through MeshController
 * methods. Inbound frames are delivered via the handle* methods.
 */
export class Forwarder {
    private readonly controller: MeshController;
    private readonly statsIntervalMs: number;
    private readonly listeners = new Map<number, net.Server>();
    private readonly pendingConns = new Map<number, PendingConn>();
    private readonly activeStreams = new Map<number, ActiveStream>();
    private nextConnId = 1;
    private statsTimer?: NodeJS.Timeout;
    private shuttingDown = false;

    constructor(controller: MeshController, options: ForwarderOptions = {}) {
        this.controller = controller;
        this.statsIntervalMs = options.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS;
    }

    public start(): void {
        this.statsTimer = setInterval(() => this.flushStats(), this.statsIntervalMs);
    }

    public async listen(port: number): Promise<void> {
        if (this.listeners.has(port) || this.shuttingDown) return;
        const server = net.createServer((socket) => this.acceptConnection(port, socket));
        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => { server.removeListener('listening', onListening); reject(err); };
            const onListening = () => { server.removeListener('error', onError); resolve(); };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(port);
        });
        this.listeners.set(port, server);
    }

    public async unlisten(port: number): Promise<void> {
        const server = this.listeners.get(port);
        if (!server) return;
        this.listeners.delete(port);
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }

    public handleResolveOk(connId: number, streamId: number, alias?: string): void {
        const pending = this.pendingConns.get(connId);
        if (!pending) {
            // Sencho thinks we have a conn but we don't (race with socket close).
            this.controller.sendClose(streamId);
            return;
        }
        this.pendingConns.delete(connId);

        const stream: ActiveStream = {
            streamId,
            socket: pending.socket,
            bytesIn: 0,
            bytesOut: 0,
            lastActivity: Date.now(),
            alias,
        };
        this.activeStreams.set(streamId, stream);

        pending.socket.on('data', (chunk: Buffer) => {
            stream.bytesOut += chunk.length;
            stream.lastActivity = Date.now();
            this.controller.sendData(streamId, chunk);
        });
        pending.socket.on('close', () => {
            if (this.activeStreams.delete(streamId)) {
                this.controller.sendClose(streamId);
            }
        });
        pending.socket.on('error', () => {
            if (this.activeStreams.delete(streamId)) {
                this.controller.sendClose(streamId);
            }
        });
    }

    public handleResolveErr(connId: number, _code: string): void {
        const pending = this.pendingConns.get(connId);
        if (!pending) return;
        this.pendingConns.delete(connId);
        try { pending.socket.destroy(); } catch { /* ignore */ }
    }

    public handleData(streamId: number, payload: Buffer): void {
        const stream = this.activeStreams.get(streamId);
        if (!stream) return;
        stream.bytesIn += payload.length;
        stream.lastActivity = Date.now();
        try { stream.socket.write(payload); } catch { /* ignore */ }
    }

    public handleClose(streamId: number): void {
        const stream = this.activeStreams.get(streamId);
        if (!stream) return;
        this.activeStreams.delete(streamId);
        try { stream.socket.destroy(); } catch { /* ignore */ }
    }

    public async shutdown(): Promise<void> {
        this.shuttingDown = true;
        if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = undefined; }
        for (const [, stream] of this.activeStreams) {
            try { stream.socket.destroy(); } catch { /* ignore */ }
        }
        this.activeStreams.clear();
        for (const [, pending] of this.pendingConns) {
            try { pending.socket.destroy(); } catch { /* ignore */ }
        }
        this.pendingConns.clear();
        const ports = Array.from(this.listeners.keys());
        await Promise.all(ports.map((p) => this.unlisten(p)));
    }

    public getActiveStreamCount(): number { return this.activeStreams.size; }
    public getListenerPorts(): number[] { return Array.from(this.listeners.keys()); }

    private acceptConnection(port: number, socket: net.Socket): void {
        if (this.shuttingDown) {
            try { socket.destroy(); } catch { /* ignore */ }
            return;
        }
        const connId = this.nextConnId++;
        this.pendingConns.set(connId, { connId, socket, port });
        const remoteAddr = socket.remoteAddress ?? '';
        socket.once('error', () => { this.pendingConns.delete(connId); });
        socket.once('close', () => { this.pendingConns.delete(connId); });
        this.controller.resolve(connId, port, remoteAddr);
    }

    private flushStats(): void {
        const now = Date.now();
        for (const [streamId, stream] of this.activeStreams) {
            // Only emit for streams that saw activity in the last interval to
            // keep the activity log readable.
            if (now - stream.lastActivity <= this.statsIntervalMs * 2) {
                this.controller.sendStats(streamId, stream.bytesIn, stream.bytesOut, stream.lastActivity);
            }
        }
    }
}
