import Docker from 'dockerode';
import WebSocket from 'ws';
import { Duplex } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const COMPOSE_DIR = process.env.COMPOSE_DIR || '/app/compose';

class DockerController {
  private static instance: DockerController;
  private docker: Docker;
  private execStream: Duplex | null = null;
  private currentExec: Docker.Exec | null = null;

  private constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  public static getInstance(): DockerController {
    if (!DockerController.instance) {
      DockerController.instance = new DockerController();
    }
    return DockerController.instance;
  }

  public async getRunningContainers() {
    const containers = await this.docker.listContainers({ all: false });
    return containers;
  }

  public async getAllContainers() {
    const containers = await this.docker.listContainers({ all: true });
    return containers;
  }

  public async getContainersByStack(stackName: string) {
    try {
      const stackDir = path.join(COMPOSE_DIR, stackName);
      const { stdout } = await execAsync('docker compose ps --format json -a', { 
        cwd: stackDir,
        env: { 
          ...process.env, 
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' 
        }
      });
      
      // Guard clause for empty output (stack has no containers)
      if (!stdout || stdout.trim() === '') {
        return [];
      }
      
      // Robust JSON parsing - handle both JSON array and newline-separated JSON objects
      // Docker Compose v2 may return either format depending on version
      interface ComposeContainer {
        ID?: string;
        Name?: string;
        State?: string;
        Status?: string;
      }
      
      let containers: ComposeContainer[];
      try {
        // Try parsing as a standard JSON array
        const parsed = JSON.parse(stdout);
        containers = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // Fallback: parse newline-separated JSON objects, filtering out empty lines
        const lines = stdout.trim().split('\n').filter(line => line.trim() !== '');
        containers = lines.map(line => JSON.parse(line) as ComposeContainer);
      }
      
      // Map to frontend's expected interface
      // Note: docker compose ps returns Name (singular), but frontend expects Names (array)
      // Dockerode returns Names with leading slash, so we add it for compatibility
      return containers.map((c) => ({
        Id: c.ID || '',
        Names: ['/' + (c.Name || '')],  // Add leading slash to match Dockerode format
        State: c.State || 'unknown',
        Status: c.Status || ''
      }));
    } catch (error) {
      // If command fails (e.g., stack not deployed), return empty array
      console.error('Failed to get containers for stack:', stackName, error);
      return [];
    }
  }

  public async startContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.start();
  }

  public async stopContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.stop();
  }

  public async restartContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.restart();
  }

  public async streamStats(containerId: string, ws: WebSocket) {
    const container = this.docker.getContainer(containerId);
    const stats = await container.stats({ stream: true });

    stats.on('data', (chunk: Buffer) => {
      ws.send(chunk.toString());
    });

    stats.on('error', (err: Error) => {
      ws.send(JSON.stringify({ error: err.message }));
    });

    stats.on('end', () => {
      ws.send(JSON.stringify({ end: true }));
    });
  }

  public async execContainer(containerId: string, ws: WebSocket) {
    try {
      const container = this.docker.getContainer(containerId);
      
      // Try bash first, fall back to sh
      let exec: Docker.Exec;
      try {
        exec = await container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Cmd: ['/bin/bash'],
        });
      } catch {
        exec = await container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          Cmd: ['/bin/sh'],
        });
      }

      this.currentExec = exec;

      const stream = await exec.start({ hijack: true, stdin: true });

      this.execStream = stream;

      // Handle output from container
      stream.on('data', (chunk: Buffer) => {
        ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
      });

      stream.on('error', (err: Error) => {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      });

      stream.on('end', () => {
        ws.send(JSON.stringify({ type: 'exit' }));
        this.execStream = null;
        this.currentExec = null;
      });

      ws.send(JSON.stringify({ type: 'connected' }));
    } catch (error) {
      const err = error as Error;
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  public sendExecInput(data: string) {
    if (this.execStream) {
      this.execStream.write(data);
    }
  }

  public async resizeExec(cols: number, rows: number) {
    if (this.currentExec) {
      try {
        await this.currentExec.resize({ w: cols, h: rows });
      } catch {
        // Ignore resize errors
      }
    }
  }
}

export default DockerController;
