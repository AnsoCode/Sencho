import http, { IncomingMessage, Server as HttpServer, ServerResponse } from 'http';
import { Socket } from 'net';
import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import {
    BinaryFrameType,
    DecodedBinaryFrame,
    StreamIdAllocator,
    decodeBinaryFrame,
    decodeJsonFrame,
    encodeBinaryFrame,
    encodeJsonFrame,
    wsDataToBuffer,
    wsDataToString,
} from '../pilot/protocol';

const BUFFER_HIGH_WATER_MARK = 4 * 1024 * 1024;
const PING_INTERVAL_MS = 30_000;

interface HttpStreamState {
    kind: 'http';
    res: ServerResponse;
    headersWritten: boolean;
}

interface WsStreamState {
    kind: 'ws';
    rawSocket?: Socket;
    rawHead?: Buffer;
    upgradeRequest: IncomingMessage;
    clientWs?: WebSocket;
}

type StreamState = HttpStreamState | WsStreamState;

/**
 * Per-tunnel bridge: hosts a loopback HTTP server that demuxes requests into
 * wire frames sent over the pilot WebSocket, and remuxes response frames back
 * to the loopback caller.
 *
 * The primary's existing http-proxy-middleware setup treats the loopback URL
 * as just another remote target, so HTTP and WebSocket proxy logic, header
 * stripping/injection, and license-tier propagation all work unchanged.
 */
export class PilotTunnelBridge extends EventEmitter {
    private readonly tunnelWs: WebSocket;
    private readonly loopback: HttpServer;
    private readonly wsUpgradeServer: WebSocketServer;
    private readonly streamIds = new StreamIdAllocator();
    private readonly streams = new Map<number, StreamState>();
    private readonly connectedAt = Date.now();
    private loopbackUrl = '';
    private pingTimer?: NodeJS.Timeout;
    private closed = false;

    constructor(_nodeId: number, tunnelWs: WebSocket) {
        super();
        this.tunnelWs = tunnelWs;
        this.loopback = http.createServer();
        this.wsUpgradeServer = new WebSocketServer({ noServer: true });

        this.loopback.on('request', (req, res) => this.handleLoopbackRequest(req, res));
        this.loopback.on('upgrade', (req, socket, head) => this.handleLoopbackUpgrade(req, socket as Socket, head));
        this.loopback.on('clientError', (_err, socket) => {
            try { socket.destroy(); } catch { /* ignore */ }
        });

        this.tunnelWs.on('message', (data, isBinary) => this.handleTunnelMessage(data, isBinary));
        this.tunnelWs.on('close', () => this.onTunnelClose());
        this.tunnelWs.on('error', () => this.onTunnelClose());
    }

    public async start(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => reject(err);
            this.loopback.once('error', onError);
            this.loopback.listen(0, '127.0.0.1', () => {
                const addr = this.loopback.address();
                if (!addr || typeof addr === 'string') {
                    reject(new Error('loopback server returned unexpected address'));
                    return;
                }
                this.loopbackUrl = `http://127.0.0.1:${addr.port}`;
                this.loopback.removeListener('error', onError);
                resolve();
            });
        });
        this.pingTimer = setInterval(() => {
            if (this.tunnelWs.readyState === WebSocket.OPEN) {
                try { this.tunnelWs.ping(); } catch { /* surfaced via 'error' */ }
            }
        }, PING_INTERVAL_MS);
    }

    public getLoopbackUrl(): string { return this.loopbackUrl; }
    public getConnectedAt(): number { return this.connectedAt; }

    public close(code = 1000, reason = 'closed by primary'): void {
        if (this.closed) return;
        this.closed = true;
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = undefined; }

        for (const [, state] of this.streams) this.teardownStream(state);
        this.streams.clear();

        try { this.tunnelWs.close(code, reason); } catch { /* ignore */ }
        try { this.loopback.close(); } catch { /* ignore */ }
        try { this.wsUpgradeServer.close(); } catch { /* ignore */ }
        this.emit('closed');
    }

    // --- Loopback HTTP ingress ---

    private handleLoopbackRequest(req: IncomingMessage, res: ServerResponse): void {
        if (this.closed || this.tunnelWs.readyState !== WebSocket.OPEN) {
            res.statusCode = 502;
            res.end('pilot tunnel not ready');
            return;
        }

        const streamId = this.streamIds.allocate();
        this.streams.set(streamId, { kind: 'http', res, headersWritten: false });

        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(', ');
        }

        this.sendJson({
            t: 'http_req',
            s: streamId,
            method: req.method || 'GET',
            path: req.url || '/',
            headers,
        });

        req.on('data', (chunk: Buffer) => {
            if (!this.streams.has(streamId)) return;
            this.sendBinary(BinaryFrameType.HttpReqBody, streamId, chunk);
            if (this.tunnelWs.bufferedAmount > BUFFER_HIGH_WATER_MARK) req.pause();
        });
        req.on('end', () => {
            if (!this.streams.has(streamId)) return;
            this.sendJson({ t: 'http_req_end', s: streamId });
        });
        req.on('error', () => {
            const s = this.streams.get(streamId);
            if (s) this.teardownStream(s);
            this.streams.delete(streamId);
        });

        res.on('close', () => {
            // Client disconnected before response finished.
            if (this.streams.has(streamId)) {
                this.streams.delete(streamId);
                this.sendJson({ t: 'http_err', s: streamId, code: 'tunnel_down', message: 'client aborted' });
            }
        });
    }

    private handleLoopbackUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
        if (this.closed || this.tunnelWs.readyState !== WebSocket.OPEN) {
            socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            socket.destroy();
            return;
        }

        const streamId = this.streamIds.allocate();
        this.streams.set(streamId, {
            kind: 'ws',
            rawSocket: socket,
            rawHead: head,
            upgradeRequest: req,
        });

        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(', ');
        }

        this.sendJson({
            t: 'ws_open',
            s: streamId,
            path: req.url || '/',
            headers,
        });

        socket.on('error', () => {
            const s = this.streams.get(streamId);
            if (s) this.teardownStream(s);
            this.streams.delete(streamId);
        });
        socket.on('close', () => {
            if (this.streams.has(streamId)) {
                this.sendJson({ t: 'ws_close', s: streamId, code: 1006, reason: 'client closed' });
                this.streams.delete(streamId);
            }
        });
    }

    // --- Tunnel ingress (frames from agent) ---

    private handleTunnelMessage(data: unknown, isBinary: boolean): void {
        if (this.closed) return;
        try {
            if (isBinary) {
                const buf = wsDataToBuffer(data);
                if (!buf) return;
                this.handleBinaryFrame(decodeBinaryFrame(buf));
            } else {
                const text = wsDataToString(data);
                if (text == null) return;
                const frame = decodeJsonFrame(text);
                this.handleJsonFrame(frame);
            }
        } catch {
            // Malformed frame: kill the tunnel to force re-sync.
            this.close(1002, 'protocol error');
        }
    }

    private handleJsonFrame(frame: ReturnType<typeof decodeJsonFrame>): void {
        switch (frame.t) {
            case 'http_res': {
                const s = this.streams.get(frame.s);
                if (!s || s.kind !== 'http') return;
                if (!s.headersWritten) {
                    try {
                        s.res.writeHead(frame.status, frame.headers);
                    } catch { /* headers already sent or invalid */ }
                    s.headersWritten = true;
                }
                break;
            }
            case 'http_res_end': {
                const s = this.streams.get(frame.s);
                if (!s || s.kind !== 'http') return;
                try { s.res.end(); } catch { /* ignore */ }
                this.streams.delete(frame.s);
                break;
            }
            case 'http_err': {
                const s = this.streams.get(frame.s);
                if (!s) return;
                if (s.kind === 'http' && !s.headersWritten) {
                    try {
                        s.res.writeHead(502, { 'content-type': 'text/plain' });
                        s.res.end(`pilot tunnel error: ${frame.code} ${frame.message}`);
                    } catch { /* ignore */ }
                } else {
                    this.teardownStream(s);
                }
                this.streams.delete(frame.s);
                break;
            }
            case 'ws_accept': {
                const s = this.streams.get(frame.s);
                if (!s || s.kind !== 'ws' || !s.rawSocket || !s.rawHead) return;
                this.wsUpgradeServer.handleUpgrade(s.upgradeRequest, s.rawSocket, s.rawHead, (ws) => {
                    s.clientWs = ws;
                    s.rawSocket = undefined;
                    s.rawHead = undefined;
                    ws.on('message', (msg, isBin) => {
                        if (isBin) {
                            this.sendBinary(BinaryFrameType.WsMessageBinary, frame.s, wsDataToBuffer(msg) ?? Buffer.alloc(0));
                        } else {
                            this.sendJson({ t: 'ws_msg_text', s: frame.s, data: wsDataToString(msg) ?? '' });
                        }
                    });
                    ws.on('close', (code, reason) => {
                        if (this.streams.has(frame.s)) {
                            this.sendJson({ t: 'ws_close', s: frame.s, code, reason: reason?.toString?.() });
                            this.streams.delete(frame.s);
                        }
                    });
                    ws.on('error', () => {
                        if (this.streams.has(frame.s)) this.streams.delete(frame.s);
                    });
                });
                break;
            }
            case 'ws_reject': {
                const s = this.streams.get(frame.s);
                if (!s || s.kind !== 'ws' || !s.rawSocket) return;
                try {
                    s.rawSocket.write(`HTTP/1.1 ${frame.status} ${frame.message}\r\n\r\n`);
                    s.rawSocket.destroy();
                } catch { /* ignore */ }
                this.streams.delete(frame.s);
                break;
            }
            case 'ws_msg_text': {
                const s = this.streams.get(frame.s);
                if (!s || s.kind !== 'ws' || !s.clientWs) return;
                try { s.clientWs.send(frame.data); } catch { /* ignore */ }
                break;
            }
            case 'ws_close': {
                const s = this.streams.get(frame.s);
                if (!s || s.kind !== 'ws') return;
                if (s.clientWs) {
                    try { s.clientWs.close(frame.code, frame.reason); } catch { /* ignore */ }
                } else if (s.rawSocket) {
                    try { s.rawSocket.destroy(); } catch { /* ignore */ }
                }
                this.streams.delete(frame.s);
                break;
            }
            case 'ctrl': {
                // Primary-side bridge does not act on control ops today; the
                // upgrade handler consumes enroll_ack before registerTunnel is
                // called, and ping/pong are handled by the WS layer.
                break;
            }
            default:
                // Ignore unknown JSON frame types for forward compatibility.
                break;
        }
    }

    private handleBinaryFrame(frame: DecodedBinaryFrame): void {
        const s = this.streams.get(frame.streamId);
        if (!s) return;
        switch (frame.type) {
            case BinaryFrameType.HttpResBody: {
                if (s.kind !== 'http') return;
                if (!s.headersWritten) {
                    // Agent sent body before headers; synthesize 200 so we don't drop data.
                    try { s.res.writeHead(200); } catch { /* ignore */ }
                    s.headersWritten = true;
                }
                try { s.res.write(frame.payload); } catch { /* ignore */ }
                break;
            }
            case BinaryFrameType.WsMessageBinary: {
                if (s.kind !== 'ws' || !s.clientWs) return;
                try { s.clientWs.send(frame.payload, { binary: true }); } catch { /* ignore */ }
                break;
            }
            case BinaryFrameType.HttpReqBody:
                // Agent never originates request bodies; ignore for defense-in-depth.
                break;
            default:
                break;
        }
    }

    private onTunnelClose(): void {
        if (this.closed) return;
        this.close(1006, 'tunnel closed');
    }

    // --- Helpers ---

    private sendJson(frame: Parameters<typeof encodeJsonFrame>[0]): void {
        if (this.tunnelWs.readyState !== WebSocket.OPEN) return;
        try { this.tunnelWs.send(encodeJsonFrame(frame)); } catch { /* ignore */ }
    }

    private sendBinary(type: BinaryFrameType, streamId: number, payload: Buffer): void {
        if (this.tunnelWs.readyState !== WebSocket.OPEN) return;
        try { this.tunnelWs.send(encodeBinaryFrame(type, streamId, payload), { binary: true }); } catch { /* ignore */ }
    }

    private teardownStream(state: StreamState): void {
        if (state.kind === 'http') {
            try {
                if (!state.headersWritten) {
                    state.res.writeHead(502, { 'content-type': 'text/plain' });
                    state.res.end('pilot tunnel closed');
                } else {
                    state.res.end();
                }
            } catch { /* ignore */ }
        } else {
            if (state.clientWs) {
                try { state.clientWs.close(1011, 'tunnel closed'); } catch { /* ignore */ }
            } else if (state.rawSocket) {
                try { state.rawSocket.destroy(); } catch { /* ignore */ }
            }
        }
    }
}
