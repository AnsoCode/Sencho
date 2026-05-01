import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { WebSocketServer, WebSocket } from 'ws';
import { MeshService } from '../services/MeshService';
import { sanitizeForLog } from '../utils/safeLog';
import { rejectUpgrade as rejectSocket } from './reject';

/**
 * Handle the local Sencho Mesh sidecar's control WebSocket. Authenticated
 * with a `mesh_sidecar`-scoped JWT minted by MeshService when it spawned the
 * sidecar; the JWT carries the node id the sidecar serves.
 *
 * The control WS is intentionally local-only: the sidecar runs in host
 * network mode on the same Docker host as Sencho and reaches us via the
 * loopback interface.
 */
export async function handleMeshControl(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    wss: WebSocketServer,
): Promise<void> {
    const authHeader = req.headers['authorization'];
    const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return rejectSocket(socket, 401, 'Unauthorized');

    const verified = MeshService.getInstance().verifySidecarToken(token);
    if (!verified) return rejectSocket(socket, 401, 'Unauthorized');

    wss.handleUpgrade(req, socket as never, head, (ws: WebSocket) => {
        MeshService.getInstance().attachSidecarSocket(ws as unknown as never, verified.nodeId);

        ws.on('message', (data, isBinary) => {
            if (isBinary) return; // V1: control plane is JSON-only.
            try {
                const text = data.toString('utf8');
                const frame = JSON.parse(text) as { t?: string; connId?: number; port?: number; remoteAddr?: string };
                if (frame.t === 'resolve' && typeof frame.connId === 'number' && typeof frame.port === 'number') {
                    MeshService.getInstance().handleSidecarResolve(
                        ws as unknown as never,
                        verified.nodeId,
                        frame.connId,
                        frame.port,
                        frame.remoteAddr ?? '',
                    );
                }
                // hello / log / stream.stats / close are advisory; we accept
                // them silently in V1. Future revisions can expand handling.
            } catch (err) {
                console.warn('[meshControl] bad frame:', sanitizeForLog((err as Error).message));
            }
        });

        ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
    });
}
