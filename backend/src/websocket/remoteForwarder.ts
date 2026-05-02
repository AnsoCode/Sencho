import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { Node } from '../services/DatabaseService';
import { PROXY_TIER_HEADER, PROXY_VARIANT_HEADER } from '../entitlements/headers';
import { getEntitlementProvider } from '../entitlements/registry';
import { wsProxyServer } from '../proxy/websocketProxy';
import { getErrorMessage } from '../utils/errors';
import { rejectUpgrade as reject } from './reject';

/**
 * Forward a WebSocket upgrade to a remote Sencho instance. Handles the
 * console_session token exchange for interactive paths so the long-lived
 * api_token never reaches an interactive terminal (the remote's upgrade
 * handler rejects node_proxy tokens on those paths).
 *
 * The caller must have already established that `node.type === 'remote'`
 * and that `api_url` + `api_token` are present.
 */
export async function handleRemoteForwarder(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: { node: Node; pathname: string },
): Promise<void> {
  const { node, pathname } = opts;
  // Guaranteed non-null by caller; assert here so the rest of the function is nullsafe.
  if (!node.api_url || !node.api_token) return reject(socket, 503, 'Service Unavailable');

  const wsTarget = node.api_url.replace(/\/$/, '').replace(/^https?/, (m) => m === 'https' ? 'wss' : 'ws');

  // Interactive console paths (host console / container exec) are guarded on
  // the remote by an isProxyToken check that rejects the long-lived api_token.
  // Exchange it for a short-lived console_session token before forwarding so
  // the remote allows the connection while keeping the guard intact for
  // direct api_token access.
  const isInteractiveConsolePath = pathname === '/api/system/host-console' || pathname === '/ws';
  let bearerTokenForProxy = node.api_token;
  if (isInteractiveConsolePath) {
    try {
      const consoleHeaders = getEntitlementProvider().getProxyHeaders();
      const tokenRes = await fetch(`${node.api_url.replace(/\/$/, '')}/api/system/console-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${node.api_token}`,
          [PROXY_TIER_HEADER]: consoleHeaders.tier,
          [PROXY_VARIANT_HEADER]: consoleHeaders.variant || '',
        },
      });
      if (!tokenRes.ok) {
        console.error(`[WS Proxy] Remote console-token request failed: ${tokenRes.status}`);
        return reject(socket, 502, 'Bad Gateway');
      }
      const data = await tokenRes.json() as { token?: string };
      if (typeof data.token === 'string') bearerTokenForProxy = data.token;
    } catch (e) {
      console.error('[WS Proxy] Failed to fetch remote console token:', getErrorMessage(e, 'unknown'));
      return reject(socket, 502, 'Bad Gateway');
    }
  }

  req.headers['authorization'] = `Bearer ${bearerTokenForProxy}`;
  delete req.headers['x-node-id'];
  // Strip the browser's session cookie: signed by this instance's JWT secret
  // and would fail verification on the remote. Auth is handled exclusively
  // via the Bearer token.
  delete req.headers['cookie'];
  const fwdHeaders = getEntitlementProvider().getProxyHeaders();
  req.headers[PROXY_TIER_HEADER] = fwdHeaders.tier;
  req.headers[PROXY_VARIANT_HEADER] = fwdHeaders.variant || '';
  // Strip nodeId from the forwarded URL so the remote treats the request as
  // local. The remote has no record of the gateway's nodeId; leaving it would
  // trigger nodeContext's 404 branch.
  const fwdUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  fwdUrl.searchParams.delete('nodeId');
  req.url = fwdUrl.pathname + (fwdUrl.searchParams.toString() ? `?${fwdUrl.searchParams.toString()}` : '');
  wsProxyServer.ws(req, socket, head, { target: wsTarget });
}
