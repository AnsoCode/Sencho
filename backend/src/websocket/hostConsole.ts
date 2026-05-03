import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import { FileSystemService } from '../services/FileSystemService';
import { NodeRegistry } from '../services/NodeRegistry';
import { HostTerminalService } from '../services/HostTerminalService';
import { PROXY_TIER_HEADER, PROXY_VARIANT_HEADER } from '../services/license-headers';
import {
  isLicenseTier,
  isLicenseVariant,
  normalizeTier,
  normalizeVariant,
} from '../services/license-normalize';
import { LicenseService } from '../services/LicenseService';
import { ROLE_PERMISSIONS, type PermissionAction } from '../middleware/permissions';
import type { UserRole } from '../services/DatabaseService';
import { getErrorMessage } from '../utils/errors';
import { rejectUpgrade as reject } from './reject';

interface HostConsoleContext {
  nodeId: number;
  decoded: { scope?: string; username?: string };
  isProxyToken: boolean;
  wsResolvedUser: { username: string; role: UserRole; token_version: number } | undefined;
  stackParam: string | null;
}

/**
 * Handle `/api/system/host-console` WebSocket upgrades.
 *
 * Enforces three gates before spawning the host PTY:
 *  1. Machine-credential rejection: node_proxy tokens cannot reach an
 *     interactive host shell.
 *  2. RBAC: user session tokens require the `system:console` permission.
 *     console_session tokens are pre-gated at issuance (see
 *     `routes/console.ts`) and skip this check.
 *  3. License: host console requires paid + admiral. For console_session
 *     tokens the tier/variant is trusted from the gateway-supplied headers;
 *     otherwise the local LicenseService is consulted.
 */
export function handleHostConsoleWs(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: HostConsoleContext,
): void {
  const { nodeId, decoded, isProxyToken, wsResolvedUser, stackParam } = ctx;

  if (isProxyToken) return reject(socket, 403, 'Forbidden');

  const isConsoleSession = decoded.scope === 'console_session';
  if (!isConsoleSession) {
    const userRole = wsResolvedUser?.role;
    const consolePermission: PermissionAction = 'system:console';
    if (!userRole || !ROLE_PERMISSIONS[userRole]?.includes(consolePermission)) {
      console.log('[HostConsole] Access denied: insufficient permissions', {
        username: wsResolvedUser?.username || decoded.username,
        role: userRole,
      });
      return reject(socket, 403, 'Forbidden');
    }
  }

  const consoleTierHeader = req.headers[PROXY_TIER_HEADER] as string | undefined;
  const consoleVariantHeader = req.headers[PROXY_VARIANT_HEADER] as string | undefined;
  const ls = LicenseService.getInstance();
  const consoleTier = (isConsoleSession && isLicenseTier(consoleTierHeader))
    ? normalizeTier(consoleTierHeader)
    : ls.getTier();
  const consoleVariant = (isConsoleSession && consoleVariantHeader !== undefined && isLicenseVariant(consoleVariantHeader))
    ? normalizeVariant(consoleVariantHeader)
    : ls.getVariant();
  if (consoleTier !== 'paid' || consoleVariant !== 'admiral') {
    return reject(socket, 403, 'Forbidden');
  }

  const consoleUsername = wsResolvedUser?.username || decoded.username || 'console_session';
  console.log('[HostConsole] WebSocket upgrade accepted', {
    username: consoleUsername,
    nodeId,
    stack: stackParam || '(root)',
  });

  const hostConsoleWss = new WebSocketServer({ noServer: true });
  hostConsoleWss.handleUpgrade(req, socket, head, (ws) => {
    hostConsoleWss.close();
    let targetDirectory = '';
    try {
      const baseDir = FileSystemService.getInstance(nodeId).getBaseDir();
      if (stackParam) {
        const resolved = path.resolve(baseDir, stackParam);
        if (!resolved.startsWith(path.resolve(baseDir))) {
          ws.send('Error: Invalid stack path\r\n');
          ws.close();
          return;
        }
        targetDirectory = resolved;
      } else {
        targetDirectory = baseDir;
      }
    } catch {
      targetDirectory = FileSystemService.getInstance(NodeRegistry.getInstance().getDefaultNodeId()).getBaseDir();
    }
    try {
      HostTerminalService.spawnTerminal(ws, targetDirectory, consoleUsername);
    } catch (error) {
      console.error('[HostConsole] Unhandled spawn error:', { user: consoleUsername, error: getErrorMessage(error, 'unknown') });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('Error: Failed to start terminal session.\r\n');
        ws.close();
      }
    }
  });
}
