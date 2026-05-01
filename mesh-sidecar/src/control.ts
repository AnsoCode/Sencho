import WebSocket from 'ws';
import { Forwarder, MeshController } from './forwarder';
import {
    ControlFrame,
    PROTOCOL_VERSION,
    decodeControl,
    decodeData,
    encodeControl,
    encodeData,
    wsDataToBuffer,
    wsDataToString,
} from './protocol';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

export interface ControlClientOptions {
    controlUrl: string;
    token: string;
    nodeId: number;
    sidecarVersion: string;
    forwarder: Forwarder;
}

/**
 * WS-backed implementation of MeshController. Keeps a single long-lived
 * connection to the local Sencho instance, surfaces inbound frames to the
 * Forwarder, and queues outbound frames when reconnecting.
 */
export class ControlClient implements MeshController {
    private readonly options: ControlClientOptions;
    private ws: WebSocket | null = null;
    private backoff = RECONNECT_MIN_MS;
    private pingTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private shuttingDown = false;

    constructor(options: ControlClientOptions) {
        this.options = options;
    }

    public start(): void {
        this.connect();
    }

    public async shutdown(): Promise<void> {
        this.shuttingDown = true;
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
        try { this.ws?.close(1000, 'sidecar shutdown'); } catch { /* ignore */ }
    }

    // --- MeshController surface ---

    public resolve(connId: number, port: number, remoteAddr: string): void {
        this.send({ t: 'resolve', connId, port, remoteAddr });
    }

    public sendData(streamId: number, payload: Buffer): void {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(encodeData(streamId, payload), { binary: true }); } catch { /* ignore */ }
    }

    public sendClose(streamId: number): void {
        this.send({ t: 'close', streamId });
    }

    public sendStats(streamId: number, bytesIn: number, bytesOut: number, lastActivity: number): void {
        this.send({ t: 'stream.stats', streamId, bytesIn, bytesOut, lastActivity });
    }

    public sendLog(level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>): void {
        this.send({ t: 'log', level, message, details });
    }

    // --- Connection lifecycle ---

    private connect(): void {
        if (this.shuttingDown) return;

        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = undefined; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }

        const ws = new WebSocket(this.options.controlUrl, {
            headers: { Authorization: `Bearer ${this.options.token}` },
            handshakeTimeout: 15_000,
        });
        this.ws = ws;

        ws.on('open', () => {
            this.backoff = RECONNECT_MIN_MS;
            this.send({
                t: 'hello',
                version: PROTOCOL_VERSION,
                nodeId: this.options.nodeId,
                sidecarVersion: this.options.sidecarVersion,
            });
            this.pingTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.ping(); } catch { /* error event will handle */ }
                }
            }, PING_INTERVAL_MS);
        });

        ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
        ws.on('close', () => {
            if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = undefined; }
            this.scheduleReconnect();
        });
        ws.on('error', () => {
            // 'close' will follow.
        });
    }

    private scheduleReconnect(): void {
        if (this.shuttingDown) return;
        const jitter = Math.floor(Math.random() * 500);
        const delay = this.backoff + jitter;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            this.connect();
        }, delay);
        this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    }

    private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
        try {
            if (isBinary) {
                const buf = wsDataToBuffer(data);
                if (!buf) return;
                const decoded = decodeData(buf);
                this.options.forwarder.handleData(decoded.streamId, decoded.payload);
            } else {
                const text = wsDataToString(data);
                if (text == null) return;
                const frame = decodeControl(text);
                this.dispatchControl(frame);
            }
        } catch {
            // Malformed frames are dropped; tunnel stays up.
        }
    }

    private dispatchControl(frame: ControlFrame): void {
        switch (frame.t) {
            case 'listen':
                void this.options.forwarder.listen(frame.port);
                break;
            case 'unlisten':
                void this.options.forwarder.unlisten(frame.port);
                break;
            case 'resolve_ok':
                this.options.forwarder.handleResolveOk(frame.connId, frame.streamId, frame.alias);
                break;
            case 'resolve_err':
                this.options.forwarder.handleResolveErr(frame.connId, frame.code);
                break;
            case 'close':
                this.options.forwarder.handleClose(frame.streamId);
                break;
            default:
                // hello / resolve / stream.stats / log are sidecar-originated;
                // ignore on the inbound path.
                break;
        }
    }

    private send(frame: ControlFrame): void {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(encodeControl(frame)); } catch { /* ignore */ }
    }
}
