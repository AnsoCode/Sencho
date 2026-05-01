import { ControlClient } from './control';
import { Forwarder } from './forwarder';

const SIDECAR_VERSION = '0.0.1';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`[mesh-sidecar] missing required env: ${name}`);
        process.exit(1);
    }
    return value;
}

function main(): void {
    const controlUrl = requireEnv('SENCHO_CONTROL_URL');
    const token = requireEnv('SENCHO_MESH_TOKEN');
    const nodeIdRaw = requireEnv('MESH_NODE_ID');
    const nodeId = Number.parseInt(nodeIdRaw, 10);
    if (!Number.isFinite(nodeId)) {
        console.error('[mesh-sidecar] MESH_NODE_ID must be an integer');
        process.exit(1);
    }

    let client: ControlClient | null = null;
    // Bridge with explicit named params so types stay tight; client is wired
    // immediately after construction so the null check is only racing against
    // the 5s stats timer first tick.
    const forwarder = new Forwarder({
        resolve: (connId, port, remoteAddr) => client?.resolve(connId, port, remoteAddr),
        sendData: (streamId, payload) => client?.sendData(streamId, payload),
        sendClose: (streamId) => client?.sendClose(streamId),
        sendStats: (streamId, bytesIn, bytesOut, lastActivity) =>
            client?.sendStats(streamId, bytesIn, bytesOut, lastActivity),
    });
    forwarder.start();

    client = new ControlClient({
        controlUrl,
        token,
        nodeId,
        sidecarVersion: SIDECAR_VERSION,
        forwarder,
    });
    client.start();

    const shutdown = async () => {
        await forwarder.shutdown();
        await client?.shutdown();
        process.exit(0);
    };
    process.on('SIGTERM', () => { void shutdown(); });
    process.on('SIGINT', () => { void shutdown(); });

    console.log(`[mesh-sidecar] started for node=${nodeId} version=${SIDECAR_VERSION}`);
}

main();
