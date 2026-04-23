import httpProxy from 'http-proxy';

/**
 * Single process-wide http-proxy instance used to forward WebSocket upgrades
 * to remote Sencho nodes. Shared between the HTTP proxy middleware (for any
 * stray WS->HTTP fallbacks) and the WebSocket upgrade handler.
 *
 * changeOrigin rewrites the Host header to the target, which is required by
 * most reverse-proxy deployments. Errors are logged and the socket destroyed;
 * an unhandled 'error' on this instance would crash the Node event loop.
 */
export const wsProxyServer = httpProxy.createProxyServer({ changeOrigin: true });

wsProxyServer.on('error', (err, _req, socket) => {
  console.error('[WS Proxy] Error:', err.message);
  try {
    (socket as { destroy?: () => void })?.destroy?.();
  } catch { /* ignore */ }
});
