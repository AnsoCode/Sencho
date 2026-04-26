import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import { ComposeService } from '../services/ComposeService';
import { isValidStackName } from '../utils/validation';
import { isDebugEnabled } from '../utils/debug';
import { getErrorMessage } from '../utils/errors';

/**
 * Handle `/api/stacks/:stackName/logs` WebSocket upgrades. Streams the
 * supervisor log loop for the given stack on the caller's node context.
 */
export function handleLogsWs(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: { nodeId: number; stackName: string },
): void {
  const { nodeId, stackName } = opts;
  const logsWss = new WebSocketServer({ noServer: true });
  logsWss.handleUpgrade(req, socket, head, (ws) => {
    // Close the per-connection server immediately after the upgrade completes.
    // The wss instance is only needed to negotiate the handshake; keeping it
    // open accumulates listeners and allocates memory for every connection.
    logsWss.close();
    if (!isValidStackName(stackName)) {
      ws.send('Error: Invalid stack name\r\n');
      ws.close();
      return;
    }
    try {
      if (isDebugEnabled()) console.debug('[Stacks:debug] WS log stream opened', { stackName, nodeId });
      ws.on('close', () => {
        if (isDebugEnabled()) console.debug('[Stacks:debug] WS log stream closed', { stackName, nodeId });
      });
      ComposeService.getInstance(nodeId).streamLogs(stackName, ws);
    } catch (error) {
      console.error('[Stacks] Failed to stream logs:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`Error streaming logs: ${getErrorMessage(error, 'unknown')}\n`);
      }
    }
  });
}
