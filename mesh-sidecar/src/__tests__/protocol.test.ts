import { describe, it, expect } from 'vitest';
import {
    BinaryFrameType,
    decodeControl,
    decodeData,
    encodeControl,
    encodeData,
} from '../protocol';

describe('Mesh sidecar control frames', () => {
    it('roundtrips a hello frame', () => {
        const raw = encodeControl({ t: 'hello', version: 1, nodeId: 7, sidecarVersion: '0.0.1' });
        const decoded = decodeControl(raw);
        expect(decoded.t).toBe('hello');
        if (decoded.t !== 'hello') throw new Error('narrowing');
        expect(decoded.nodeId).toBe(7);
    });

    it('roundtrips a listen / unlisten pair', () => {
        const listen = decodeControl(encodeControl({ t: 'listen', port: 5432 }));
        const unlisten = decodeControl(encodeControl({ t: 'unlisten', port: 5432 }));
        expect(listen.t).toBe('listen');
        expect(unlisten.t).toBe('unlisten');
    });

    it('roundtrips resolve / resolve_ok / resolve_err', () => {
        const resolve = decodeControl(encodeControl({ t: 'resolve', connId: 1, port: 5432, remoteAddr: '10.0.0.5' }));
        const ok = decodeControl(encodeControl({ t: 'resolve_ok', connId: 1, streamId: 9, alias: 'db.api.opsix.sencho' }));
        const err = decodeControl(encodeControl({ t: 'resolve_err', connId: 1, code: 'tunnel_down' }));
        if (resolve.t !== 'resolve') throw new Error('narrowing');
        if (ok.t !== 'resolve_ok') throw new Error('narrowing');
        if (err.t !== 'resolve_err') throw new Error('narrowing');
        expect(resolve.port).toBe(5432);
        expect(ok.streamId).toBe(9);
        expect(err.code).toBe('tunnel_down');
    });

    it('rejects malformed control frames', () => {
        expect(() => decodeControl('not json')).toThrow();
        expect(() => decodeControl('{}')).toThrow();
    });
});

describe('Mesh sidecar data frames', () => {
    it('encodes the 0x01 type discriminator', () => {
        const buf = encodeData(1, Buffer.from('hello'));
        expect(buf[0]).toBe(BinaryFrameType.Data);
    });

    it('roundtrips streamId + payload', () => {
        const payload = Buffer.from('SELECT 1;');
        const buf = encodeData(0xdeadbeef, payload);
        const decoded = decodeData(buf);
        expect(decoded.streamId).toBe(0xdeadbeef);
        expect(decoded.payload.toString()).toBe('SELECT 1;');
    });

    it('preserves binary payloads byte-for-byte', () => {
        const payload = Buffer.from([0x00, 0xff, 0x01, 0x80, 0x7f]);
        const decoded = decodeData(encodeData(1, payload));
        expect(decoded.payload.equals(payload)).toBe(true);
    });

    it('rejects an unknown binary frame type', () => {
        const buf = Buffer.alloc(5);
        buf.writeUInt8(0x99, 0);
        expect(() => decodeData(buf)).toThrow(/unknown binary frame type/);
    });

    it('rejects too-short frames', () => {
        expect(() => decodeData(Buffer.alloc(3))).toThrow(/too short/);
    });
});
