/**
 * Regression guard for WebSocket upgrade dispatch order.
 *
 * `websocket/upgradeHandler.ts` dispatches upgrades in a first-match-wins
 * ladder: pilot tunnel, then auth, then API-token scope gate, then
 * notifications (local-only), then remote forwarder, then stack logs, then
 * host console, then generic. Reordering the ladder silently breaks several
 * product paths. This test pins each position by observing behavior that
 * could only originate from the expected handler.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';
import { setupTestDb, cleanupTestDb, TEST_USERNAME, TEST_JWT_SECRET } from './helpers/setupTestDb';

describe('WebSocket upgrade dispatch order', () => {
  let tmpDir: string;
  let server: import('http').Server;
  let port: number;
  let sessionCookie: string;
  let remoteNodeId: number;

  beforeAll(async () => {
    tmpDir = await setupTestDb();
    ({ server } = await import('../index'));

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    port = addr.port;

    const { DatabaseService } = await import('../services/DatabaseService');
    remoteNodeId = DatabaseService.getInstance().addNode({
      name: 'upgrade-order-remote',
      type: 'remote',
      compose_dir: '/tmp',
      is_default: false,
      api_url: 'http://127.0.0.1:1',
      api_token: 'upgrade-order-token',
    });

    const token = jwt.sign({ username: TEST_USERNAME }, TEST_JWT_SECRET, { expiresIn: '1m' });
    sessionCookie = `sencho_token=${token}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    cleanupTestDb(tmpDir);
  });

  function connect(pathAndQuery: string, opts: { cookie?: string } = {}): WebSocket {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers['cookie'] = opts.cookie;
    return new WebSocket(`ws://127.0.0.1:${port}${pathAndQuery}`, { headers });
  }

  /** Wait for an open or a failure; resolves with one of several outcomes. */
  function waitForOutcome(ws: WebSocket, timeoutMs = 3000): Promise<
    | { kind: 'open' }
    | { kind: 'unexpected'; status: number }
    | { kind: 'close'; code: number }
    | { kind: 'error' }
    | { kind: 'timeout' }
  > {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      const done = (outcome: Awaited<ReturnType<typeof waitForOutcome>>): void => {
        clearTimeout(timer);
        resolve(outcome);
      };
      ws.once('open', () => done({ kind: 'open' }));
      ws.once('unexpected-response', (_req, res) => done({ kind: 'unexpected', status: res.statusCode ?? 0 }));
      ws.once('close', (code: number) => done({ kind: 'close', code }));
      ws.once('error', () => done({ kind: 'error' }));
    });
  }

  async function waitForSubscriberCount(target: number, timeoutMs = 2000): Promise<number> {
    const { NotificationService } = await import('../services/NotificationService');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = NotificationService.getInstance().getSubscriberCount();
      if (count === target) return count;
      await new Promise((r) => setTimeout(r, 25));
    }
    return NotificationService.getInstance().getSubscriberCount();
  }

  it('rejects unauthenticated upgrades with HTTP 401 (default-deny)', async () => {
    const ws = connect('/ws');
    const outcome = await waitForOutcome(ws);
    expect(outcome.kind).toBe('unexpected');
    if (outcome.kind === 'unexpected') expect(outcome.status).toBe(401);
  });

  it('routes /ws/notifications (local, no nodeId) to the notifications handler', async () => {
    const { NotificationService } = await import('../services/NotificationService');
    const before = NotificationService.getInstance().getSubscriberCount();

    const ws = connect('/ws/notifications', { cookie: sessionCookie });
    const outcome = await waitForOutcome(ws);
    expect(outcome.kind).toBe('open');

    const afterOpen = NotificationService.getInstance().getSubscriberCount();
    expect(afterOpen).toBe(before + 1);

    ws.close();
    const afterClose = await waitForSubscriberCount(before);
    expect(afterClose).toBe(before);
  });

  it('routes /ws/notifications?nodeId=<remote> to the remote forwarder, not local notifications', async () => {
    const { NotificationService } = await import('../services/NotificationService');
    const before = NotificationService.getInstance().getSubscriberCount();

    const ws = connect(`/ws/notifications?nodeId=${remoteNodeId}`, { cookie: sessionCookie });
    await waitForOutcome(ws);

    // Whichever outcome arrives, the local subscriber count MUST NOT have
    // incremented. If it did, a remote-targeted upgrade is reaching the local
    // notifications handler, which is exactly the bug the dispatch order
    // prevents.
    await new Promise((r) => setTimeout(r, 50));
    expect(NotificationService.getInstance().getSubscriberCount()).toBe(before);
    try { ws.terminate(); } catch { /* ignore */ }
  });

  it('routes /api/stacks/<name>/logs to the logs handler (distinct error frame on invalid name)', async () => {
    const ws = connect('/api/stacks/%2Einvalid/logs', { cookie: sessionCookie });

    const firstMessage = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no frame received')), 2000);
      ws.once('message', (data: WebSocket.Data) => {
        clearTimeout(timer);
        resolve(data.toString());
      });
      ws.once('error', (e) => { clearTimeout(timer); reject(e); });
    });

    expect(firstMessage).toContain('Invalid stack name');
    try { ws.terminate(); } catch { /* ignore */ }
  });

  it('dispatches /api/pilot/tunnel to the pilot handler (rejects non-pilot bearer before path-based dispatch)', async () => {
    // A plain session cookie is a valid *user* JWT but not a pilot JWT. The
    // pilot handler runs first (before the shared cookie/Bearer auth) and
    // does its own Bearer check. Because this request carries only a cookie
    // and no Bearer, pilotTunnel rejects with 401. Any other outcome means
    // the ladder has been reordered: either the shared auth ran first and
    // let the cookie through, or the unknown-path catch-all handled it.
    const ws = connect('/api/pilot/tunnel', { cookie: sessionCookie });
    const outcome = await waitForOutcome(ws);
    expect(outcome.kind).toBe('unexpected');
    if (outcome.kind === 'unexpected') expect(outcome.status).toBe(401);
  });
});
