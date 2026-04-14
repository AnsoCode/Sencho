import * as os from 'os';
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import { execSync } from 'child_process';
import { isDebugEnabled } from '../utils/debug';

let cachedShell: string | null = null;
function getUnixShell(): string {
    if (cachedShell) return cachedShell;
    try {
        execSync('which bash', { stdio: 'ignore' });
        cachedShell = 'bash';
    } catch (e) {
        console.warn('[HostTerminalService] bash not found, falling back to sh:', (e as Error).message);
        cachedShell = 'sh';
    }
    return cachedShell;
}

// Pattern-based filtering: block any env var whose name contains sensitive keywords.
// Broad matching is intentional; false positives (stripping a benign var like COLORTERM)
// are safer than false negatives (leaking a secret through printenv).
const SENSITIVE_PATTERNS = /SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|PRIVATE|AUTH|PASSPHRASE|ENCRYPT|SIGNING/i;

// Explicit set catches well-known connection strings that may not match the pattern.
const SENSITIVE_KEYS = new Set(['DATABASE_URL', 'REDIS_URL', 'MONGO_URI', 'AMQP_URL', 'DSN']);

const MAX_CONSOLE_SESSIONS = 5;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 60_000;

// Cached sanitized environment; process.env does not change at runtime.
let cachedSafeEnv: Record<string, string> | null = null;

export class HostTerminalService {
    static activeSessions = new Map<number, { username: string; startedAt: number }>();

    /**
     * Sanitize a set of environment variables by removing entries whose names
     * match sensitive patterns or are in the explicit blocklist.
     */
    static sanitizeEnv(env: Record<string, string>): Record<string, string> {
        return Object.fromEntries(
            Object.entries(env).filter(
                ([k]) => !SENSITIVE_PATTERNS.test(k) && !SENSITIVE_KEYS.has(k)
            )
        );
    }

    static spawnTerminal(ws: WebSocket, targetDirectory: string, username: string) {
        // Enforce concurrent session limit
        if (HostTerminalService.activeSessions.size >= MAX_CONSOLE_SESSIONS) {
            console.warn('[HostConsole] Session rejected: max concurrent sessions reached', {
                current: HostTerminalService.activeSessions.size,
                max: MAX_CONSOLE_SESSIONS,
                user: username,
            });
            ws.send('Error: Maximum console sessions reached. Close an existing session and try again.\r\n');
            ws.close();
            return;
        }

        const shell = os.platform() === 'win32' ? 'powershell.exe' : getUnixShell();
        if (!cachedSafeEnv) {
            cachedSafeEnv = HostTerminalService.sanitizeEnv(process.env as Record<string, string>);
        }
        const startedAt = Date.now();

        let ptyProcess: pty.IPty;
        try {
            ptyProcess = pty.spawn(shell, [], {
                name: 'xterm-color',
                cols: 80,
                rows: 30,
                cwd: targetDirectory,
                env: cachedSafeEnv,
            });
        } catch (e) {
            const msg = (e as Error).message || '';
            console.error('[HostConsole] Failed to spawn PTY', { user: username, directory: targetDirectory, error: msg });
            if (/ENOENT|not found/i.test(msg)) {
                ws.send('Error: Shell not found on this system. Ensure bash or sh is installed.\r\n');
            } else if (/EACCES|permission/i.test(msg)) {
                ws.send('Error: Permission denied when spawning shell process.\r\n');
            } else {
                ws.send('Error: Failed to start terminal session.\r\n');
            }
            ws.close();
            return;
        }

        const pid = ptyProcess.pid;
        HostTerminalService.activeSessions.set(pid, { username, startedAt });
        console.log('[HostConsole] Session opened', { user: username, directory: targetDirectory, shell, pid });

        // Guard against duplicate cleanup when both WS close and PTY exit fire
        let cleaned = false;
        const cleanup = (source: string, extra?: Record<string, unknown>) => {
            if (cleaned) return;
            cleaned = true;
            clearInterval(pingInterval);
            HostTerminalService.activeSessions.delete(pid);
            const durationMs = Date.now() - startedAt;
            console.log(`[HostConsole] Session closed (${source})`, { user: username, pid, durationMs, ...extra });
        };

        // Heartbeat: detect dead connections and clean up orphaned PTY processes
        let lastPong = Date.now();
        const pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
                if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
                    console.warn('[HostConsole] Heartbeat timeout, terminating session', { user: username, pid });
                    clearInterval(pingInterval);
                    ws.terminate();
                    ptyProcess.kill();
                }
            }
        }, PING_INTERVAL_MS);
        ws.on('pong', () => { lastPong = Date.now(); });

        ptyProcess.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data); // Raw-Down protocol
            }
        });

        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
            try {
                const parsed = JSON.parse(raw.toString()); // JSON-Up protocol
                if (parsed.type === 'input') {
                    ptyProcess.write(parsed.payload);
                } else if (parsed.type === 'resize') {
                    ptyProcess.resize(parsed.cols, parsed.rows);
                    if (isDebugEnabled()) console.debug('[HostConsole:diag] Terminal resized', { cols: parsed.cols, rows: parsed.rows, pid });
                }
            } catch (e) {
                console.error('[HostConsole] Failed to parse terminal message:', { pid, error: (e as Error).message });
            }
        });

        ws.on('close', () => {
            cleanup('WS');
            ptyProcess.kill();
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            cleanup('PTY exit', { exitCode, signal });
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
    }
}
