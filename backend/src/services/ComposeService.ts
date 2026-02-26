import { spawn } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
import DockerController from './DockerController';
import { LogFormatter } from './LogFormatter';

export class ComposeService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.COMPOSE_DIR || '/app/compose';
  }

  /**
   * Run docker compose up or down command
   * CRITICAL: cwd is set to the stack directory so relative paths in compose files
   * resolve correctly inside the isolated stack folder
   */
  runCommand(stackName: string, action: 'up' | 'down', ws?: WebSocket) {
    const stackDir = path.join(this.baseDir, stackName);

    // Run docker compose from within the stack directory
    // This ensures relative paths (e.g., ./data:/config) resolve correctly
    const args = action === 'up'
      ? ['compose', 'up', '-d']
      : ['compose', 'down'];

    const child = spawn('docker', args, {
      cwd: stackDir,  // CRITICAL: Set working directory to stack folder
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    });

    if (ws) {
      child.stdout.on('data', (data: Buffer) => {
        ws.send(data.toString());
      });

      child.stderr.on('data', (data: Buffer) => {
        ws.send(data.toString());
      });

      child.on('close', (code: number | null) => {
        ws.send(`Command exited with code ${code}\n`);
      });

      child.on('error', (error: Error) => {
        console.error(`Docker Compose Error for ${stackName}:`, error.message);
        ws.send(`Error: ${error.message}\n`);
      });
    }
  }

  /**
   * Stream docker logs for a stack via WebSocket.
   * Supervisors: Fetches containers via DockerController and spawns `docker logs -f` for each.
   * Automatically re-spawns on process exit if WebSocket is still OPEN, creating a persistent stream.
   * Kills the child processes when the WebSocket closes.
   */
  streamLogs(stackName: string, ws: WebSocket) {
    let isClosed = false;
    let isFirstRun = true;
    let isWaitingForActivity = false;

    ws.on('close', () => {
      isClosed = true;
    });

    const startStream = async () => {
      if (isClosed || ws.readyState !== WebSocket.OPEN) return;

      try {
        const dockerController = DockerController.getInstance();
        const containers = await dockerController.getContainersByStack(stackName);

        if (!containers || containers.length === 0) {
          if (!isWaitingForActivity) {
            ws.send(`\r\n\x1b[33m[Sencho] No containers found. Waiting for activity...\x1b[0m\r\n`);
            isWaitingForActivity = true;
          }
          setTimeout(startStream, 2000);
          return;
        }

        const runningContainers = containers.filter(c => c.State === 'running');

        // If not first run and no containers are running, we poll to wait for activity
        if (!isFirstRun && runningContainers.length === 0) {
          if (!isWaitingForActivity) {
            ws.send(`\r\n\x1b[33m[Sencho] Log stream ended. Waiting for container activity...\x1b[0m\r\n`);
            isWaitingForActivity = true;
          }
          setTimeout(startStream, 2000);
          return;
        }

        // On first run, we stream all containers to dump history.
        // On subsequent runs, we only attach to running containers to avoid immediate exit loop.
        const containersToLog = isFirstRun ? containers : runningContainers;
        isFirstRun = false;
        isWaitingForActivity = false; // Reset since we are tracking active elements

        let activeProcesses = 0;
        let streamEndedHandled = false;
        const childProcesses: ReturnType<typeof spawn>[] = [];

        const onWsClose = () => {
          childProcesses.forEach(cp => {
            try { cp.kill(); } catch { /* ignore */ }
          });
        };

        ws.on('close', onWsClose);

        const handleProcessEnd = () => {
          activeProcesses--;
          if (activeProcesses <= 0 && !streamEndedHandled) {
            streamEndedHandled = true;
            ws.removeListener('close', onWsClose);

            if (!isClosed && ws.readyState === WebSocket.OPEN) {
              setTimeout(startStream, 1000);
            }
          }
        };

        for (const container of containersToLog) {
          const containerName = container.Names?.[0]?.replace(/^\//, '') || container.Id;
          const child = spawn('docker', ['logs', '-f', '--tail', '100', containerName], {
            env: {
              ...process.env,
              PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
            }
          });

          activeProcesses++;
          childProcesses.push(child);

          let lineBuffer = '';

          const sendOutput = (data: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) {
              lineBuffer += data.toString();
              const lines = lineBuffer.split(/\r?\n/);

              // The last element is either an incomplete line or empty string
              lineBuffer = lines.pop() || '';

              for (const line of lines) {
                const formattedLine = LogFormatter.process(line);
                ws.send(formattedLine + '\r\n');
              }
            }
          };

          child.stdout.on('data', sendOutput);
          child.stderr.on('data', sendOutput);
          child.on('error', handleProcessEnd);
          child.on('close', () => {
            // Flush any remaining partial line before ending
            if (lineBuffer && ws.readyState === WebSocket.OPEN) {
              const formattedLine = LogFormatter.process(lineBuffer);
              ws.send(formattedLine + '\r\n');
              lineBuffer = '';
            }
            handleProcessEnd();
          });
        }

      } catch (err) {
        if (!isClosed && ws.readyState === WebSocket.OPEN) {
          if (!isWaitingForActivity) {
            ws.send(`\r\n\x1b[31m[Sencho] Error tracking containers. Retrying...\x1b[0m\r\n`);
            isWaitingForActivity = true;
          }
          setTimeout(startStream, 2000);
        }
      }
    };

    startStream();
  }

  /**
   * Update stack: pull images first, then recreate containers
   * CRITICAL: cwd is set to the stack directory so relative paths resolve correctly
   */
  async updateStack(stackName: string, ws?: WebSocket): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);

    const sendOutput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    // Step 1: Pull images
    sendOutput('=== Pulling latest images ===\n');
    await new Promise<void>((resolve, reject) => {
      const pullProcess = spawn('docker', ['compose', 'pull'], {
        cwd: stackDir,
        env: {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        }
      });

      pullProcess.stdout.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      pullProcess.stderr.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      pullProcess.on('close', (code: number | null) => {
        if (code === 0) {
          sendOutput('=== Images pulled successfully ===\n');
          resolve();
        } else {
          sendOutput(`=== Pull failed with code ${code} ===\n`);
          reject(new Error(`Pull failed with code ${code}`));
        }
      });

      pullProcess.on('error', (error: Error) => {
        console.error(`Docker Compose Pull Error for ${stackName}:`, error.message);
        sendOutput(`Pull error: ${error.message}\n`);
        reject(error);
      });
    });

    // Step 2: Recreate containers with new images
    sendOutput('=== Recreating containers ===\n');
    await new Promise<void>((resolve, reject) => {
      const upProcess = spawn('docker', ['compose', 'up', '-d'], {
        cwd: stackDir,
        env: {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        }
      });

      let errorLog = '';

      upProcess.stdout.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      upProcess.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        errorLog += text;
        sendOutput(text);
      });

      upProcess.on('close', (code: number | null) => {
        if (code === 0) {
          sendOutput('=== Stack updated successfully ===\n');
          resolve();
        } else {
          sendOutput(`=== Update failed with code ${code} ===\n`);
          reject(new Error(errorLog.trim() || `Up failed with code ${code}`));
        }
      });

      upProcess.on('error', (error: Error) => {
        console.error(`Docker Compose Up Error for ${stackName}:`, error.message);
        sendOutput(`Update error: ${error.message}\n`);
        reject(error);
      });
    });
  }
}
