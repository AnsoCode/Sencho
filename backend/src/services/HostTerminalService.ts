import * as os from 'os';
import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import { execSync } from 'child_process';

function getUnixShell() {
    try {
        execSync('which bash', { stdio: 'ignore' });
        return 'bash';
    } catch {
        return 'sh';
    }
}

export class HostTerminalService {
    static spawnTerminal(ws: WebSocket, targetDirectory: string) {
        const shell = os.platform() === 'win32' ? 'powershell.exe' : getUnixShell();

        const ptyProcess = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: targetDirectory,
            env: process.env as Record<string, string>,
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
