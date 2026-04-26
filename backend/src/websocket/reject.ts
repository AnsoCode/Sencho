import type { Duplex } from 'stream';

/**
 * Write an HTTP status line and destroy the socket. Used by every WebSocket
 * handler to reject an upgrade before a successful handshake. Errors during
 * write/destroy are intentionally swallowed: the socket is already being
 * torn down and nothing downstream can recover.
 */
export function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  try { socket.write(`HTTP/1.1 ${status} ${message}\r\n\r\n`); } catch { /* ignore */ }
  try { socket.destroy(); } catch { /* ignore */ }
}
