import Docker from 'dockerode';
import WebSocket from 'ws';
import { Duplex } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import * as yaml from 'yaml';

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
    const stackDir = path.join(COMPOSE_DIR, stackName);
    
    try {
      const { stdout, stderr } = await execAsync('docker compose ps --format json -a', { 
        cwd: stackDir,
        env: { 
          ...process.env, 
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' 
        }
      });
      
      // Robust JSON parsing - handle both JSON array and newline-separated JSON objects
      // Docker Compose v2 may return either format depending on version
      interface ComposeContainer {
        ID?: string;
        Name?: string;
        State?: string;
        Status?: string;
      }
      
      let containers: ComposeContainer[] = [];
      
      // Only parse if stdout has content
      if (stdout && stdout.trim() !== '') {
        try {
          // Try parsing as a standard JSON array
          const parsed = JSON.parse(stdout);
          containers = Array.isArray(parsed) ? parsed : [parsed];
        } catch (parseError) {
          // Fallback: parse newline-separated JSON objects, filtering out empty lines
          try {
            const lines = stdout.trim().split('\n').filter(line => line.trim() !== '');
            containers = lines.map(line => JSON.parse(line) as ComposeContainer);
          } catch (innerError) {
            // Log parsing failure with stderr for debugging
            console.error(`Docker Compose JSON Parse Error for ${stackName}:`, stderr || (parseError as Error).message);
            // Don't return empty - trigger smart fallback below
          }
        }
      }
      
      // If containers found via docker compose ps, return them
      if (containers.length > 0) {
        // Map to frontend's expected interface
        // Note: docker compose ps returns Name (singular), but frontend expects Names (array)
        // Dockerode returns Names with leading slash, so we add it for compatibility
        return containers.map((c) => ({
          Id: c.ID || '',
          Names: ['/' + (c.Name || '')],  // Add leading slash to match Dockerode format
          State: c.State || 'unknown',
          Status: c.Status || ''
        }));
      }
      
      // SMART FALLBACK: Trigger when docker compose ps returns empty
      // This handles legacy containers with incorrect project labels
      return await this.smartFallback(stackName, stackDir);
      
    } catch (error) {
      // If command fails (e.g., stack not deployed, invalid YAML, missing env_file)
      const execError = error as { stderr?: string; message?: string };
      console.error(`Docker Compose Error for ${stackName}:`, execError.stderr || execError.message);
      
      // Try smart fallback even on error
      return await this.smartFallback(stackName, stackDir);
    }
  }

  /**
   * Smart Fallback: Find legacy containers by parsing compose YAML definitions.
   * This handles containers that were deployed with incorrect project labels
   * that cause `docker compose ps` to ignore them.
   */
  private async smartFallback(stackName: string, stackDir: string): Promise<any[]> {
    try {
      // 1. Flexible Compose File Discovery
      // Try multiple valid compose file names
      const composeFileNames = ['compose.yaml', 'docker-compose.yml', 'compose.yml', 'docker-compose.yaml'];
      let yamlContent: string | null = null;
      
      for (const fileName of composeFileNames) {
        try {
          yamlContent = await fs.readFile(path.join(stackDir, fileName), 'utf-8');
          break; // Successfully read a file, stop trying
        } catch {
          // File doesn't exist, try next
          continue;
        }
      }
      
      if (!yamlContent) {
        // No compose file found
        return [];
      }
      
      const parsedYaml = yaml.parse(yamlContent);
      
      if (!parsedYaml || !parsedYaml.services) return [];

      // 2. Extract expected container names with legacy prefix support
      const expectedNames: string[] = [];
      for (const [serviceName, serviceConfig] of Object.entries(parsedYaml.services)) {
        const config = serviceConfig as any;
        if (config.container_name) {
          expectedNames.push(config.container_name);
        } else {
          // Standard v2 naming
          expectedNames.push(serviceName);
          expectedNames.push(`${stackName}-${serviceName}-1`);
          // Legacy project prefix catch - accounts for orphan containers
          expectedNames.push(`compose-${serviceName}-1`);
          expectedNames.push(`compose_${serviceName}_1`);
        }
      }

      // 3. Query the raw Docker daemon
      const allContainers = await this.docker.listContainers({ all: true });
      
      // 4. Match containers by name
      const fallbackContainers = allContainers.filter(container => {
        // container.Names usually looks like ['/plex']
        return container.Names.some(name => {
          const strippedName = name.replace(/^\//, '');
          return expectedNames.includes(strippedName);
        });
      });

      // 5. Map to the frontend interface
      return fallbackContainers.map(c => ({
        Id: c.Id,
        Names: c.Names,
        State: c.State,
        Status: c.Status
      }));
    } catch (fallbackError) {
      console.error(`Smart Fallback failed for ${stackName}:`, fallbackError);
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
