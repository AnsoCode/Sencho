import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';
import DockerController from './DockerController';
import { DatabaseService } from './DatabaseService';
import { FileSystemService } from './FileSystemService';
import { LogFormatter } from './LogFormatter';
import { NodeRegistry } from './NodeRegistry';
import { RegistryService } from './RegistryService';

/**
 * ComposeService - local docker compose CLI execution.
 *
 * In the Distributed API model, remote node compose operations are handled
 * by the remote Sencho instance. This service only executes commands locally.
 */
export class ComposeService {
  private baseDir: string;
  private nodeId: number;

  constructor(nodeId?: number) {
    this.nodeId = nodeId ?? NodeRegistry.getInstance().getDefaultNodeId();
    this.baseDir = NodeRegistry.getInstance().getComposeDir(this.nodeId);
  }

  public static getInstance(nodeId?: number): ComposeService {
    return new ComposeService(nodeId);
  }

  private execute(
    command: string,
    args: string[],
    cwd: string,
    ws?: WebSocket,
    throwOnError = true,
    env?: Record<string, string | undefined>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: env ?? {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        }
      });

      let errorLog = '';

      const onData = (data: Buffer) => {
        const text = data.toString();
        errorLog += text;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(text);
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('close', (code: number | null) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(`Command exited with code ${code}\n`);
        }
        if (code === 0) resolve();
        else if (throwOnError) reject(new Error(errorLog.trim() || `Command failed with code ${code}`));
        else resolve();
      });

      child.on('error', (error: Error) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(`Error: ${error.message}\n`);
        }
        if (throwOnError) reject(error);
        else resolve();
      });
    });
  }

  private async withRegistryAuth<T>(fn: (env: Record<string, string | undefined>) => Promise<T>): Promise<T> {
    const registries = DatabaseService.getInstance().getRegistries();
    if (registries.length === 0) {
      return fn({
        ...process.env,
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      });
    }

    const dockerConfig = await RegistryService.getInstance().resolveDockerConfig();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sencho-docker-'));
    const configPath = path.join(tmpDir, 'config.json');

    try {
      fs.writeFileSync(configPath, JSON.stringify(dockerConfig), { mode: 0o600 });
      return await fn({
        ...process.env,
        DOCKER_CONFIG: tmpDir,
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      });
    } finally {
      try { fs.unlinkSync(configPath); fs.rmdirSync(tmpDir); } catch { /* best-effort cleanup */ }
    }
  }

  async runCommand(stackName: string, action: 'down' | 'start' | 'stop' | 'restart', ws?: WebSocket): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    await this.execute('docker', ['compose', action], stackDir, ws);
  }

  async deployStack(stackName: string, ws?: WebSocket, atomic?: boolean): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    const sendOutput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    };

    // Atomic: backup files before deploying
    if (atomic) {
      try {
        const fsSvc = FileSystemService.getInstance(this.nodeId);
        await fsSvc.backupStackFiles(stackName);
        sendOutput('=== Backup created for atomic deployment ===\n');
      } catch (e) {
        console.warn(`Failed to backup stack files for ${stackName}:`, e);
      }
    }

    try {
      try {
        const dockerController = DockerController.getInstance(this.nodeId);
        const legacyContainers = await dockerController.getContainersByStack(stackName);
        if (legacyContainers && legacyContainers.length > 0) {
          sendOutput(`=== Cleaning up existing containers for clean deployment ===\n`);
          await dockerController.removeContainers(legacyContainers.map((c: any) => c.Id));
        }
      } catch (e) {
        console.warn(`Failed to clean up legacy containers for ${stackName}:`, e);
      }

      await this.withRegistryAuth(async (env) => {
        await this.execute('docker', ['compose', 'up', '-d', '--remove-orphans'], stackDir, ws, true, env);
      });

      // Post-Deploy Health Probe
      await new Promise(resolve => setTimeout(resolve, 3000));

      const dockerController = DockerController.getInstance(this.nodeId);
      const containers = await dockerController.getDocker().listContainers({
        all: true,
        filters: { label: [`com.docker.compose.project=${stackName}`] }
      });

      for (const containerInfo of containers) {
        if (containerInfo.State === 'exited') {
          const container = dockerController.getDocker().getContainer(containerInfo.Id);
          const inspectData = await container.inspect();
          const exitCode = inspectData.State.ExitCode;

          if (exitCode !== 0) {
            const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
            const logStr = logs.toString('utf-8');
            throw new Error(`CONTAINER_CRASHED\nExit Code: ${exitCode}\n${logStr}`);
          }
        }
      }
    } catch (deployError) {
      // Atomic: auto-rollback on failure
      if (atomic) {
        sendOutput('\n=== Deployment failed - rolling back to previous version ===\n');
        try {
          const fsSvc = FileSystemService.getInstance(this.nodeId);
          await fsSvc.restoreStackFiles(stackName);
          await this.withRegistryAuth(async (env) => {
            await this.execute('docker', ['compose', 'up', '-d', '--remove-orphans'], stackDir, ws, true, env);
          });
          sendOutput('=== Rolled back successfully ===\n');
        } catch (rollbackError) {
          console.error(`Rollback failed for ${stackName}:`, rollbackError);
          sendOutput('=== Rollback failed - manual intervention may be required ===\n');
        }
      }
      throw deployError;
    }
  }

  streamLogs(stackName: string, ws: WebSocket) {
    let isClosed = false;
    let isFirstRun = true;
    let isWaitingForActivity = false;

    ws.on('close', () => { isClosed = true; });

    const startStream = async () => {
      if (isClosed || ws.readyState !== WebSocket.OPEN) return;

      try {
        const dockerController = DockerController.getInstance(this.nodeId);
        const containers = await dockerController.getContainersByStack(stackName);

        if (!containers || containers.length === 0) {
          if (!isWaitingForActivity) {
            ws.send(`\r\n\x1b[33m[Sencho] No containers found. Waiting for activity...\x1b[0m\r\n`);
            isWaitingForActivity = true;
          }
          setTimeout(startStream, 2000);
          return;
        }

        const runningContainers = containers.filter((c: any) => c.State === 'running');

        if (!isFirstRun && runningContainers.length === 0) {
          if (!isWaitingForActivity) {
            ws.send(`\r\n\x1b[33m[Sencho] Log stream ended. Waiting for container activity...\x1b[0m\r\n`);
            isWaitingForActivity = true;
          }
          setTimeout(startStream, 2000);
          return;
        }

        const containersToLog = isFirstRun ? containers : runningContainers;
        isFirstRun = false;
        isWaitingForActivity = false;

        let activeProcesses = 0;
        let streamEndedHandled = false;
        const localProcesses: ReturnType<typeof spawn>[] = [];

        const onWsClose = () => {
          localProcesses.forEach(cp => { try { cp.kill(); } catch { } });
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
          activeProcesses++;
          let lineBuffer = '';

          const sendOutput = (data: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) {
              lineBuffer += data.toString();
              const lines = lineBuffer.split(/\r?\n/);
              lineBuffer = lines.pop() || '';
              for (const line of lines) {
                ws.send(LogFormatter.process(line) + '\r\n');
              }
            }
          };

          const flushBuffer = () => {
            if (lineBuffer && ws.readyState === WebSocket.OPEN) {
              ws.send(LogFormatter.process(lineBuffer) + '\r\n');
              lineBuffer = '';
            }
          };

          const child = spawn('docker', ['logs', '-f', '--tail', '100', containerName], {
            env: {
              ...process.env,
              PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
            }
          });
          localProcesses.push(child);
          child.stdout.on('data', sendOutput);
          child.stderr.on('data', sendOutput);
          child.on('error', handleProcessEnd);
          child.on('close', () => {
            flushBuffer();
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

  async updateStack(stackName: string, ws?: WebSocket, atomic?: boolean): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    const sendOutput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    };

    // Atomic: backup files before updating
    if (atomic) {
      try {
        const fsSvc = FileSystemService.getInstance(this.nodeId);
        await fsSvc.backupStackFiles(stackName);
        sendOutput('=== Backup created for atomic update ===\n');
      } catch (e) {
        console.warn(`Failed to backup stack files for ${stackName}:`, e);
      }
    }

    try {
      try {
        const dockerController = DockerController.getInstance(this.nodeId);
        const legacyContainers = await dockerController.getContainersByStack(stackName);
        if (legacyContainers && legacyContainers.length > 0) {
          sendOutput(`=== Cleaning up existing containers for clean update ===\n`);
          await dockerController.removeContainers(legacyContainers.map((c: any) => c.Id));
        }
      } catch (e) {
        console.warn(`Failed to clean up legacy containers for ${stackName}:`, e);
      }

      await this.withRegistryAuth(async (env) => {
        sendOutput('=== Pulling latest images ===\n');
        await this.execute('docker', ['compose', 'pull'], stackDir, ws, true, env);

        sendOutput('=== Recreating containers ===\n');
        await this.execute('docker', ['compose', 'up', '-d', '--remove-orphans'], stackDir, ws, true, env);
      });

      // Post-Update Health Probe
      await new Promise(resolve => setTimeout(resolve, 3000));

      const dockerController = DockerController.getInstance(this.nodeId);
      const containers = await dockerController.getDocker().listContainers({
        all: true,
        filters: { label: [`com.docker.compose.project=${stackName}`] }
      });

      for (const containerInfo of containers) {
        if (containerInfo.State === 'exited') {
          const container = dockerController.getDocker().getContainer(containerInfo.Id);
          const inspectData = await container.inspect();
          const exitCode = inspectData.State.ExitCode;

          if (exitCode !== 0) {
            const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
            const logStr = logs.toString('utf-8');
            throw new Error(`CONTAINER_CRASHED\nExit Code: ${exitCode}\n${logStr}`);
          }
        }
      }

      sendOutput('=== Stack updated successfully ===\n');
    } catch (updateError) {
      // Atomic: auto-rollback on failure
      if (atomic) {
        sendOutput('\n=== Update failed - rolling back to previous version ===\n');
        try {
          const fsSvc = FileSystemService.getInstance(this.nodeId);
          await fsSvc.restoreStackFiles(stackName);
          await this.withRegistryAuth(async (env) => {
            await this.execute('docker', ['compose', 'up', '-d', '--remove-orphans'], stackDir, ws, true, env);
          });
          sendOutput('=== Rolled back successfully ===\n');
        } catch (rollbackError) {
          console.error(`Rollback failed for ${stackName}:`, rollbackError);
          sendOutput('=== Rollback failed - manual intervention may be required ===\n');
        }
      }
      throw updateError;
    }
  }

  public async downStack(stackName: string): Promise<void> {
    const stackPath = path.join(this.baseDir, stackName);
    try {
      await this.execute('docker', ['compose', 'down'], stackPath, undefined, false);
    } catch (error) {
      console.warn(`[Teardown] Docker down failed or nothing to clean up for ${stackName}`);
    }
  }
}
