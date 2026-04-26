import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import DockerController from '../services/DockerController';
import { DatabaseService } from '../services/DatabaseService';
import { NodeRegistry } from '../services/NodeRegistry';
import { isDebugEnabled } from '../utils/debug';
import { rejectUpgrade as reject } from './reject';

/**
 * Module-scope singleton: the most recent WebSocket to send
 * `{action: 'connectTerminal'}` receives streaming output from any subsequent
 * compose deploy/down/update. Routes that want to echo compose progress read
 * the current value via `getTerminalWs()`.
 *
 * Intentionally single-instance. If multiple clients connect, the last one
 * wins. This matches pre-refactor behavior; race-hardening is a separate
 * concern.
 */
let terminalWs: WebSocket | undefined;

export function getTerminalWs(): WebSocket | undefined {
  return terminalWs;
}

interface GenericContext {
  decoded: { scope?: string; username?: string; tv?: number };
  isProxyToken: boolean;
}

/**
 * Handle the generic `/ws` upgrade: terminal (container exec) and streaming
 * stats. Gates node-proxy tokens and non-admin users; the subsequent
 * connection handler processes `{action: ...}` messages from the client.
 */
export function handleGenericWs(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocketServer,
  ctx: GenericContext,
): void {
  const { decoded, isProxyToken } = ctx;

  if (isProxyToken) return reject(socket, 403, 'Forbidden');

  // Admin enforcement: container exec requires admin role.
  // console_session tokens are already admin-gated at creation time.
  // API tokens reaching this point have full-admin scope (read-only /
  // deploy-only are blocked by the upgrade handler's scope gate).
  if (!decoded.scope) {
    const execUser = decoded.username ? DatabaseService.getInstance().getUserByUsername(decoded.username) : undefined;
    if (!execUser) {
      console.warn('[Exec] User account not found:', decoded.username);
      return reject(socket, 401, 'Unauthorized');
    }
    if (decoded.tv !== undefined && execUser.token_version !== decoded.tv) {
      console.warn('[Exec] Session invalidated (token version mismatch):', decoded.username);
      return reject(socket, 401, 'Unauthorized');
    }
    if (execUser.role !== 'admin') {
      console.warn('[Exec] Non-admin user rejected:', decoded.username);
      return reject(socket, 403, 'Forbidden');
    }
  }

  if (isDebugEnabled()) {
    console.debug('[Exec:diag] WS upgrade for exec path', {
      username: decoded.username,
      scope: decoded.scope || 'user-session',
    });
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
}

/**
 * Wire up the `connection` handler on the main wss. Processes `{action}`
 * messages for `connectTerminal` (captures the ws for deploy-output
 * streaming), `streamStats`, and `execContainer`. `{type}` messages (input,
 * resize, ping) are handled by per-session listeners registered inside
 * `execContainer`'s closure.
 */
export function attachGenericConnectionHandlers(wss: WebSocketServer): void {
  wss.on('connection', (ws) => {
    console.log('WebSocket connected');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (!data.action) return;

        if (data.action === 'connectTerminal') {
          terminalWs = ws;
        } else if (data.action === 'streamStats') {
          const requestedId = data.nodeId ? parseInt(data.nodeId, 10) : NodeRegistry.getInstance().getDefaultNodeId();
          // When a WS is proxied from a gateway to this remote instance, the
          // nodeId in the message belongs to the gateway's DB and won't
          // resolve locally. Fall back to local.
          let nodeId = requestedId;
          try { NodeRegistry.getInstance().getDocker(requestedId); } catch { nodeId = NodeRegistry.getInstance().getDefaultNodeId(); }
          DockerController.getInstance(nodeId).streamStats(data.containerId, ws).catch((err: Error) => {
            console.error('[WS] streamStats error:', err.message);
            if (ws.readyState === WebSocket.OPEN) ws.close();
          });
        } else if (data.action === 'execContainer') {
          const requestedId = data.nodeId ? parseInt(data.nodeId, 10) : NodeRegistry.getInstance().getDefaultNodeId();
          let nodeId = requestedId;
          try { NodeRegistry.getInstance().getDocker(requestedId); } catch { nodeId = NodeRegistry.getInstance().getDefaultNodeId(); }
          DockerController.getInstance(nodeId).execContainer(data.containerId, ws).catch((err: Error) => {
            console.error('[WS] execContainer error:', err.message);
            if (ws.readyState === WebSocket.OPEN) ws.close();
          });
        }
      } catch {
        // Malformed JSON - ignore silently
      }
    });
  });
}
