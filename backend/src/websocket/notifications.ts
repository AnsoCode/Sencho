import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer } from 'ws';
import { NotificationService } from '../services/NotificationService';

/**
 * Accept a `/ws/notifications` upgrade, register the resulting socket as a
 * NotificationService subscriber, and wire up cleanup on close/error.
 *
 * The per-connection `WebSocketServer` exists only to negotiate the handshake
 * and is closed immediately afterward to avoid accumulating listeners.
 */
export function handleNotificationsWs(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const notifWss = new WebSocketServer({ noServer: true });
  notifWss.handleUpgrade(req, socket, head, (ws) => {
    notifWss.close();
    const unsubscribe = NotificationService.getInstance().subscribe(ws);
    ws.on('close', unsubscribe);
    ws.on('error', () => {
      unsubscribe();
      ws.terminate();
    });
  });
}
