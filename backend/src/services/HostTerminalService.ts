import * as os from 'os';
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import { execSync } from 'child_process';

function getUnixShell() {
    try {
        execSync('which bash', { stdio: 'ignore' });
        return 'bash';
    } catch (e) {
        console.warn('[HostTerminalService] bash not found, falling back to sh:', (e as Error).message);
        return 'sh';
    }
}

export class HostTerminalService {
    static spawnTerminal(ws: WebSocket, targetDirectory: string) {
        const shell = os.platform() === 'win32' ? 'powershell.exe' : getUnixShell();

        // Strip sensitive backend secrets from the PTY environment so they are not
        // visible to the console user via `env` / `printenv`.
        // Pattern-based filtering: block any env var containing sensitive keywords.
        // Explicit fallback set catches vars that don't match patterns (e.g. DATABASE_URL).
        const SENSITIVE_PATTERNS = /SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL/i;
        const SENSITIVE_KEYS = new Set(['DATABASE_URL']);
        const safeEnv = Object.fromEntries(
            Object.entries(process.env as Record<string, string>).filter(
                ([k]) => !SENSITIVE_PATTERNS.test(k) && !SENSITIVE_KEYS.has(k)
            )
        );

        const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: targetDirectory,
            env: safeEnv,
        });

        ptyProcess.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data); // Raw-Down protocol
            }
        });

        ws.on('message', (message: string) => {
            try {
                const parsed = JSON.parse(message); // JSON-Up protocol
                if (parsed.type === 'input') {
                    ptyProcess.write(parsed.payload);
                } else if (parsed.type === 'resize') {
                    ptyProcess.resize(parsed.cols, parsed.rows);
                }
            } catch (e) {
                console.error('Failed to parse Host terminal message:', e);
            }
        });

        ws.on('close', () => {
            console.log('Host terminal WebSocket closed, cleaning up PTY process');
            ptyProcess.kill();
        });

        // Handle PTY process exit
        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`Host terminal PTY process exited with code ${exitCode} and signal ${signal}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
    }
}
