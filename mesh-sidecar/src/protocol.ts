/**
 * Mesh sidecar control protocol. Wire-compatible shape with the pilot tunnel:
 * JSON text frames for control + a single binary frame type carrying the
 * tunneled bytes.
 *
 *   [ 1 byte: BinaryFrameType ][ 4 bytes: streamId (BE) ][ payload bytes... ]
 */

export const PROTOCOL_VERSION = 1;

export enum BinaryFrameType {
    Data = 0x01,
}

export type ControlFrame =
    | ListenFrame
    | UnlistenFrame
    | HelloFrame
    | ResolveFrame
    | ResolveOkFrame
    | ResolveErrFrame
    | StreamStatsFrame
    | LogFrame
    | CloseFrame;

export interface HelloFrame {
    t: 'hello';
    version: number;
    nodeId: number;
    sidecarVersion: string;
}

/** Sencho -> sidecar: start listening on a TCP port for inbound app traffic. */
export interface ListenFrame {
    t: 'listen';
    port: number;
}

/** Sencho -> sidecar: stop listening on the given port. */
export interface UnlistenFrame {
    t: 'unlisten';
    port: number;
}

/**
 * Sidecar -> Sencho: a new local TCP connection arrived on this port; what
 * stream should I attach it to?
 */
export interface ResolveFrame {
    t: 'resolve';
    connId: number;
    port: number;
    remoteAddr?: string;
}

/** Sencho -> sidecar: forward bytes for connId via streamId. */
export interface ResolveOkFrame {
    t: 'resolve_ok';
    connId: number;
    streamId: number;
    alias?: string;
}

/** Sencho -> sidecar: drop the connection with a reason. */
export interface ResolveErrFrame {
    t: 'resolve_err';
    connId: number;
    code: 'no_route' | 'tunnel_down' | 'denied' | 'unreachable' | 'agent_error';
    message?: string;
}

/** Sidecar -> Sencho: per-stream byte counters every ~5 seconds while open. */
export interface StreamStatsFrame {
    t: 'stream.stats';
    streamId: number;
    bytesIn: number;
    bytesOut: number;
    lastActivity: number;
}

/** Sidecar -> Sencho: structured log line surfaced into the activity log. */
export interface LogFrame {
    t: 'log';
    level: 'info' | 'warn' | 'error';
    message: string;
    details?: Record<string, unknown>;
}

/** Either side -> close a stream. */
export interface CloseFrame {
    t: 'close';
    streamId: number;
}

export function encodeControl(frame: ControlFrame): string {
    return JSON.stringify(frame);
}

export function decodeControl(raw: string): ControlFrame {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.t !== 'string') {
        throw new Error('invalid control frame: missing type discriminator');
    }
    return parsed as ControlFrame;
}

export function encodeData(streamId: number, payload: Buffer): Buffer {
    if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffffffff) {
        throw new Error(`invalid streamId: ${streamId}`);
    }
    const out = Buffer.allocUnsafe(5 + payload.length);
    out.writeUInt8(BinaryFrameType.Data, 0);
    out.writeUInt32BE(streamId, 1);
    payload.copy(out, 5);
    return out;
}

export interface DecodedData {
    streamId: number;
    payload: Buffer;
}

export function decodeData(buf: Buffer): DecodedData {
    if (buf.length < 5) throw new Error(`data frame too short: ${buf.length} bytes`);
    const type = buf.readUInt8(0);
    if (type !== BinaryFrameType.Data) throw new Error(`unknown binary frame type: ${type}`);
    return {
        streamId: buf.readUInt32BE(1),
        payload: buf.subarray(5),
    };
}

export type WsRawData = Buffer | ArrayBuffer | Buffer[] | string;

export function wsDataToBuffer(data: WsRawData): Buffer | null {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (Array.isArray(data)) return Buffer.concat(data.map((d) => Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer)));
    return null;
}

export function wsDataToString(data: WsRawData): string | null {
    if (typeof data === 'string') return data;
    const buf = wsDataToBuffer(data);
    return buf ? buf.toString('utf8') : null;
}
