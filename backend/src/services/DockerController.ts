import Docker from 'dockerode';
import WebSocket from 'ws';
import { Duplex } from 'stream';

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
    const containers = await this.docker.listContainers({ all: true });
    // Normalize the stack name: remove all non-alphanumeric characters and lowercase
    // Docker Compose strips hyphens and underscores from project names
    const normalizedStackName = stackName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    
    return containers.filter(container => {
      if (!container.Labels || !container.Labels['com.docker.compose.project']) {
        return false;
      }
      // Normalize the Docker label for comparison
      const projectLabel = container.Labels['com.docker.compose.project'].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return projectLabel === normalizedStackName;
    });
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
