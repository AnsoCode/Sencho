import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import WebSocket from 'ws';
import DockerController from './DockerController';
import { LogFormatter } from './LogFormatter';
import { NodeRegistry } from './NodeRegistry';
import { Client as SSHClient } from 'ssh2';

const execAsync = promisify(exec);

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

  /**
   * Universal command execution (Local or Remote SSH)
   */
  private async executeCommand(
    command: string, 
    args: string[], 
    cwd: string, 
    ws?: WebSocket, 
    throwOnError = true
  ): Promise<void> {
    const node = NodeRegistry.getInstance().getNode(this.nodeId);
    if (!node) throw new Error(`Node ${this.nodeId} not found`);

    if (node.type === 'local' || !node.host) {
      return this.executeLocal(command, args, cwd, ws, throwOnError);
    } else {
      return this.executeRemote(node, command, args, cwd, ws, throwOnError);
    }
  }

  private async executeLocal(
    command: string, 
    args: string[], 
    cwd: string, 
    ws?: WebSocket,
    throwOnError = true
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
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

  private async executeRemote(
    node: any,
    command: string, 
    args: string[], 
    cwd: string, 
    ws?: WebSocket,
    throwOnError = true
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let errorLog = '';

      conn.on('ready', () => {
        const cmdString = `cd "${cwd}" && ${command} ${args.map(a => `"${a}"`).join(' ')}`;
        
        conn.exec(cmdString, (err, stream) => {
          if (err) {
            conn.end();
            if (throwOnError) reject(err); else resolve();
            return;
          }

          const onData = (data: any) => {
            const text = data.toString();
            errorLog += text;
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(text);
            }
          };

          stream.on('data', onData).stderr.on('data', onData);
          
          stream.on('close', (code: any, signal: any) => {
            conn.end();
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(`Command exited with code ${code}\n`);
            }
            if (code === 0) resolve();
            else if (throwOnError) reject(new Error(errorLog.trim() || `Command failed with code ${code}`));
            else resolve();
          });
        });
      }).on('error', (err) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(`SSH Error: ${err.message}\n`);
        if (throwOnError) reject(err); else resolve();
      }).connect({
        host: node.host,
        port: node.port || 22,
        username: node.ssh_user!,
        password: node.ssh_password,
        privateKey: node.ssh_key,
        readyTimeout: 10000,
      });
    });
  }

  async runCommand(stackName: string, action: 'down' | 'start' | 'stop' | 'restart', ws?: WebSocket): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    await this.executeCommand('docker', ['compose', action], stackDir, ws);
  }

  async deployStack(stackName: string, ws?: WebSocket): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);

    try {
      const dockerController = DockerController.getInstance(this.nodeId);
      const legacyContainers = await dockerController.getContainersByStack(stackName);
      if (legacyContainers && legacyContainers.length > 0) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(`=== Cleaning up existing containers for clean deployment ===\n`);
        await dockerController.removeContainers(legacyContainers.map((c: any) => c.Id));
      }
    } catch (e) {
      console.warn(`Failed to clean up legacy containers for ${stackName}:`, e);
    }

    await this.executeCommand('docker', ['compose', 'up', '-d', '--remove-orphans'], stackDir, ws);

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
          let logStr = logs.toString('utf-8');
          throw new Error(`CONTAINER_CRASHED\nExit Code: ${exitCode}\n${logStr}`);
        }
      }
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
        
        let clientConnections: any[] = [];
        let localProcesses: ReturnType<typeof spawn>[] = [];

        const onWsClose = () => {
          localProcesses.forEach(cp => { try { cp.kill(); } catch {} });
          clientConnections.forEach(conn => { try { conn.end(); } catch {} });
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

        const node = NodeRegistry.getInstance().getNode(this.nodeId);
        const isRemote = (node && node.type === 'remote' && node.host);

        for (const container of containersToLog) {
          const containerName = container.Names?.[0]?.replace(/^\//, '') || container.Id;
          activeProcesses++;
          let lineBuffer = '';

          const sendOutput = (data: Buffer | any) => {
            if (ws.readyState === WebSocket.OPEN) {
              lineBuffer += data.toString();
              const lines = lineBuffer.split(/\r?\n/);
              lineBuffer = lines.pop() || '';
              for (const line of lines) {
                const formattedLine = LogFormatter.process(line);
                ws.send(formattedLine + '\r\n');
              }
            }
          };

          const flushBuffer = () => {
             if (lineBuffer && ws.readyState === WebSocket.OPEN) {
                const formattedLine = LogFormatter.process(lineBuffer);
                ws.send(formattedLine + '\r\n');
                lineBuffer = '';
            }
          }

          if (isRemote) {
            const conn = new SSHClient();
            clientConnections.push(conn);
            conn.on('ready', () => {
              conn.exec(`docker logs -f --tail 100 "${containerName}"`, {
                env: {
                  ...process.env,
                  PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
                }
              }, (err, stream) => {
                if (err) {
                  conn.end();
                  handleProcessEnd();
                  return;
                }
                stream.on('data', sendOutput).stderr.on('data', sendOutput);
                stream.on('close', () => {
                   flushBuffer();
                   conn.end();
                   handleProcessEnd();
                });
              });
            }).on('error', handleProcessEnd).connect({
              host: node!.host,
              port: node!.port || 22,
              username: node!.ssh_user!,
              password: node!.ssh_password,
              privateKey: node!.ssh_key,
              readyTimeout: 10000,
            });
          } else {
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

  async updateStack(stackName: string, ws?: WebSocket): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    const sendOutput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    };

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

    sendOutput('=== Pulling latest images ===\n');
    await this.executeCommand('docker', ['compose', 'pull'], stackDir, ws);

    sendOutput('=== Recreating containers ===\n');
    await this.executeCommand('docker', ['compose', 'up', '-d', '--remove-orphans'], stackDir, ws);
    sendOutput('=== Stack updated successfully ===\n');
  }

  public async downStack(stackName: string): Promise<void> {
    const stackPath = path.join(this.baseDir, stackName);
    try {
      await this.executeCommand('docker', ['compose', 'down'], stackPath, undefined, false);
    } catch (error) {
      console.warn(`[Teardown] Docker down failed or nothing to clean up for ${stackName}`);
    }
  }
}
