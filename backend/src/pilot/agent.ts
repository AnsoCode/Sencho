import fs from 'fs';
import path from 'path';
import http from 'http';
import WebSocket from 'ws';
import { getSenchoVersion } from '../services/CapabilityRegistry';
import {
    BinaryFrameType,
    PROTOCOL_VERSION,
    decodeBinaryFrame,
    decodeJsonFrame,
    encodeBinaryFrame,
    encodeJsonFrame,
    wsDataToBuffer,
    wsDataToString,
} from './protocol';
import { sanitizeForLog } from '../utils/safeLog';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
const PING_INTERVAL_MS = 30_000;
const TOKEN_PATH = path.join(process.env.DATA_DIR || '/app/data', 'pilot.jwt');

/**
 * Pilot agent: dials the primary via outbound WebSocket and tunnels every
 * inbound frame to the agent's own loopback HTTP server (the fully-booted
 * Sencho app). Because the tunnel is the only ingress, the agent needs no
 * open port, no TLS certificate, and no reachable address.
 */
export function startPilotAgent(loopbackPort: number): void {
    const primaryUrl = process.env.SENCHO_PRIMARY_URL;
    if (!primaryUrl) {
        console.error('[Pilot] SENCHO_PRIMARY_URL is required when SENCHO_MODE=pilot');
        process.exit(1);
    }

    const enrollToken = process.env.SENCHO_ENROLL_TOKEN;
    const persistedToken = readPersistedToken();

    if (!enrollToken && !persistedToken) {
        console.error('[Pilot] SENCHO_ENROLL_TOKEN is required on first boot');
        process.exit(1);
    }

    const agent = new PilotAgent({
        primaryUrl,
        loopbackPort,
        initialToken: persistedToken || enrollToken!,
        enrolling: !persistedToken,
    });
    agent.start();
}

interface AgentOptions {
    primaryUrl: string;
    loopbackPort: number;
    initialToken: string;
    enrolling: boolean;
}

class PilotAgent {
    private readonly options: AgentOptions;
    private token: string;
    private backoff = RECONNECT_MIN_MS;
    private ws: WebSocket | null = null;
    private pingTimer?: NodeJS.Timeout;
    private reconnectTimer?: NodeJS.Timeout;
    private readonly httpStreams = new Map<number, { req: http.ClientRequest }>();
    private readonly wsStreams = new Map<number, WebSocket>();
    private shuttingDown = false;
    private readonly agentVersion: string;

    constructor(options: AgentOptions) {
        this.options = options;
        this.token = options.initialToken;
        this.agentVersion = getSenchoVersion() || '0.0.0';
    }

    public start(): void {
        this.connect();
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }

    private shutdown(): void {
        this.shuttingDown = true;
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
        try { this.ws?.close(1000, 'agent shutdown'); } catch { /* ignore */ }
    }

    private connect(): void {
        if (this.shuttingDown) return;

        const wsUrl = this.options.primaryUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/pilot/tunnel';
        const ws = new WebSocket(wsUrl, {
            headers: {
                Authorization: `Bearer ${this.token}`,
                'x-sencho-agent-version': this.agentVersion,
            },
            handshakeTimeout: 15_000,
        });
        this.ws = ws;

        ws.on('open', () => {
            console.log('[Pilot] Tunnel connected to', this.options.primaryUrl);
            this.backoff = RECONNECT_MIN_MS;
            try {
                ws.send(encodeJsonFrame({
                    t: 'hello',
                    version: PROTOCOL_VERSION,
                    role: 'agent',
                    agentVersion: this.agentVersion,
                }));
            } catch (err) {
                console.error('[Pilot] Failed to send hello:', (err as Error).message);
            }
            this.pingTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    try { ws.ping(); } catch { /* surfaced via error */ }
                }
            }, PING_INTERVAL_MS);
        });

        ws.on('message', (data, isBinary) => this.handleFrame(data, isBinary));
        ws.on('close', (code, reason) => {
            console.log('[Pilot] Tunnel closed:', code, reason?.toString?.() ?? '');
            this.cleanupAfterDisconnect();
            this.scheduleReconnect();
        });
        ws.on('error', (err) => {
            console.warn('[Pilot] Tunnel error:', err.message);
            // 'close' will follow; reconnect is scheduled there.
        });
    }

    private cleanupAfterDisconnect(): void {
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = undefined; }
        for (const [, entry] of this.httpStreams) {
            try { entry.req.destroy(); } catch { /* ignore */ }
        }
        this.httpStreams.clear();
        for (const [, ws] of this.wsStreams) {
            try { ws.close(1006, 'tunnel closed'); } catch { /* ignore */ }
        }
        this.wsStreams.clear();
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

    private handleFrame(data: unknown, isBinary: boolean): void {
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
        } catch (err) {
            console.warn('[Pilot] Malformed frame from primary:', sanitizeForLog((err as Error).message));
        }
    }

    private handleJsonFrame(frame: ReturnType<typeof decodeJsonFrame>): void {
        const ws = this.ws;
        if (!ws) return;
        switch (frame.t) {
            case 'hello': {
                if (frame.version !== PROTOCOL_VERSION) {
                    console.error(`[Pilot] Protocol version ${sanitizeForLog(frame.version)} from primary is incompatible with agent (${PROTOCOL_VERSION}); exiting.`);
                    this.shuttingDown = true;
                    try { ws.close(1002, 'incompatible version'); } catch { /* ignore */ }
                    process.exit(1);
                }
                break;
            }
            case 'ctrl': {
                if (frame.op === 'enroll_ack' && frame.payload && typeof frame.payload.token === 'string') {
                    this.token = frame.payload.token;
                    persistToken(this.token);
                    console.log('[Pilot] Enrollment complete; long-lived token persisted.');
                }
                break;
            }
            case 'http_req': this.onHttpReq(frame); break;
            case 'http_req_end': this.onHttpReqEnd(frame.s); break;
            case 'ws_open': this.onWsOpen(frame); break;
            case 'ws_msg_text': this.onWsMsgText(frame.s, frame.data); break;
            case 'ws_close': this.onWsClose(frame.s, frame.code, frame.reason); break;
            default:
                // Other frame types are primary-bound only; agent ignores.
                break;
        }
    }

    private handleBinaryFrame(frame: ReturnType<typeof decodeBinaryFrame>): void {
        switch (frame.type) {
            case BinaryFrameType.HttpReqBody: {
                const entry = this.httpStreams.get(frame.streamId);
                if (!entry) return;
                try { entry.req.write(frame.payload); } catch { /* ignore */ }
                break;
            }
            case BinaryFrameType.WsMessageBinary: {
                const ws = this.wsStreams.get(frame.streamId);
                if (!ws) return;
                try { ws.send(frame.payload, { binary: true }); } catch { /* ignore */ }
                break;
            }
            default:
                break;
        }
    }

    // --- HTTP dispatch (tunnel -> loopback) ---

    private onHttpReq(frame: Extract<ReturnType<typeof decodeJsonFrame>, { t: 'http_req' }>): void {
        const ws = this.ws;
        if (!ws) return;

        const req = http.request({
            host: '127.0.0.1',
            port: this.options.loopbackPort,
            method: frame.method,
            path: frame.path,
            headers: { ...frame.headers, host: `127.0.0.1:${this.options.loopbackPort}` },
        }, (res) => {
            const outHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
                if (typeof v === 'string') outHeaders[k] = v;
                else if (Array.isArray(v)) outHeaders[k] = v.join(', ');
            }
            try {
                ws.send(encodeJsonFrame({
                    t: 'http_res',
                    s: frame.s,
                    status: res.statusCode || 200,
                    headers: outHeaders,
                }));
            } catch { /* ignore */ }

            res.on('data', (chunk: Buffer) => {
                try { ws.send(encodeBinaryFrame(BinaryFrameType.HttpResBody, frame.s, chunk), { binary: true }); } catch { /* ignore */ }
            });
            res.on('end', () => {
                try { ws.send(encodeJsonFrame({ t: 'http_res_end', s: frame.s })); } catch { /* ignore */ }
                this.httpStreams.delete(frame.s);
            });
            res.on('error', () => {
                try { ws.send(encodeJsonFrame({ t: 'http_err', s: frame.s, code: 'bad_response', message: 'upstream error' })); } catch { /* ignore */ }
                this.httpStreams.delete(frame.s);
            });
        });

        req.on('error', (err) => {
            try {
                ws.send(encodeJsonFrame({
                    t: 'http_err',
                    s: frame.s,
                    code: 'agent_error',
                    message: err.message || 'agent request failed',
                }));
            } catch { /* ignore */ }
            this.httpStreams.delete(frame.s);
        });

        this.httpStreams.set(frame.s, { req });
    }

    private onHttpReqEnd(streamId: number): void {
        const entry = this.httpStreams.get(streamId);
        if (!entry) return;
        try { entry.req.end(); } catch { /* ignore */ }
    }

    // --- WebSocket dispatch (tunnel -> loopback) ---

    private onWsOpen(frame: Extract<ReturnType<typeof decodeJsonFrame>, { t: 'ws_open' }>): void {
        const ws = this.ws;
        if (!ws) return;

        const target = `ws://127.0.0.1:${this.options.loopbackPort}${frame.path}`;
        const client = new WebSocket(target, {
            headers: { ...frame.headers, host: `127.0.0.1:${this.options.loopbackPort}` },
        });

        client.on('open', () => {
            try { ws.send(encodeJsonFrame({ t: 'ws_accept', s: frame.s, headers: {} })); } catch { /* ignore */ }
            this.wsStreams.set(frame.s, client);
        });
        client.on('message', (data, isBinary) => {
            if (isBinary) {
                try { ws.send(encodeBinaryFrame(BinaryFrameType.WsMessageBinary, frame.s, wsDataToBuffer(data) ?? Buffer.alloc(0)), { binary: true }); } catch { /* ignore */ }
            } else {
                try { ws.send(encodeJsonFrame({ t: 'ws_msg_text', s: frame.s, data: wsDataToString(data) ?? '' })); } catch { /* ignore */ }
            }
        });
        client.on('close', (code, reason) => {
            try { ws.send(encodeJsonFrame({ t: 'ws_close', s: frame.s, code, reason: reason?.toString?.() })); } catch { /* ignore */ }
            this.wsStreams.delete(frame.s);
        });
        client.on('error', () => {
            try { ws.send(encodeJsonFrame({ t: 'ws_reject', s: frame.s, status: 502, message: 'agent websocket failed' })); } catch { /* ignore */ }
            this.wsStreams.delete(frame.s);
        });
    }

    private onWsMsgText(streamId: number, data: string): void {
        const ws = this.wsStreams.get(streamId);
        if (!ws) return;
        try { ws.send(data); } catch { /* ignore */ }
    }

    private onWsClose(streamId: number, code: number, reason?: string): void {
        const ws = this.wsStreams.get(streamId);
        if (!ws) return;
        try { ws.close(code, reason); } catch { /* ignore */ }
        this.wsStreams.delete(streamId);
    }
}

function readPersistedToken(): string | null {
    try {
        if (fs.existsSync(TOKEN_PATH)) {
            return fs.readFileSync(TOKEN_PATH, 'utf8').trim() || null;
        }
    } catch { /* ignore */ }
    return null;
}

function persistToken(token: string): void {
    try {
        const dir = path.dirname(TOKEN_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(TOKEN_PATH, token, { mode: 0o600 });
    } catch (err) {
        console.warn('[Pilot] Failed to persist tunnel token:', (err as Error).message);
    }
}

