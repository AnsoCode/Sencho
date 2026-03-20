import Docker from 'dockerode';
import WebSocket from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import * as yaml from 'yaml';

import { NodeRegistry } from './NodeRegistry';

const execAsync = promisify(exec);
const COMPOSE_DIR = process.env.COMPOSE_DIR || '/app/compose';

class DockerController {
  private docker: Docker;
  private nodeId: number;

  private constructor(nodeId: number) {
    this.nodeId = nodeId;
    this.docker = NodeRegistry.getInstance().getDocker(nodeId);
  }

  public static getInstance(nodeId?: number): DockerController {
    const id = nodeId ?? NodeRegistry.getInstance().getDefaultNodeId();
    return new DockerController(id);
  }

  public getDocker(): Docker {
    return this.docker;
  }

  private validateApiData<T>(data: any): T {
    // If the daemon port points to a web server (like Sencho UI), Dockerode receives HTML
    if (typeof data === 'string') {
      throw new Error("Invalid response from Docker API. Did you provide a web port instead of the Docker daemon port?");
    }
    return data as T;
  }

  public async getDiskUsage() {
    const df = await this.docker.df();

    const calculateReclaimableContainers = (items: any[]) => {
      if (!items || !Array.isArray(items)) return 0;
      return items.filter(i => i.State !== 'running').reduce((acc, item) => {
        let size = item.SizeRw || item.SizeRootFs || 0;
        if (item.UsageData && typeof item.UsageData.Size === 'number') {
          size = item.UsageData.Size;
        }
        return acc + size;
      }, 0);
    };

    const calculateReclaimableImages = (items: any[]) => {
      if (!items || !Array.isArray(items)) return 0;
      return items.filter(i => i.Containers === 0).reduce((acc, item) => {
        let size = item.VirtualSize || item.Size || item.SharedSize || 0;
        if (item.UsageData && typeof item.UsageData.Size === 'number') {
          size = item.UsageData.Size;
        }
        return acc + size;
      }, 0);
    };

    const calculateReclaimableVolumes = (items: any[]) => {
      if (!items || !Array.isArray(items)) return 0;
      return items.filter(i => i.UsageData?.RefCount === 0).reduce((acc, item) => {
        let size = item.UsageData?.Size || 0;
        return acc + size;
      }, 0);
    };

    return {
      reclaimableImages: df.Images ? calculateReclaimableImages(df.Images) : 0,
      reclaimableContainers: df.Containers ? calculateReclaimableContainers(df.Containers) : 0,
      reclaimableVolumes: df.Volumes ? calculateReclaimableVolumes(df.Volumes) : 0,
    };
  }

  public async pruneSystem(target: 'containers' | 'images' | 'networks' | 'volumes') {
    let result: any = {};
    if (target === 'containers') {
      result = await this.docker.pruneContainers();
    } else if (target === 'images') {
      // Remove all unused images, not just dangling ones
      result = await this.docker.pruneImages({ filters: { dangling: { 'false': true } } });
    } else if (target === 'networks') {
      result = await this.docker.pruneNetworks();
    } else if (target === 'volumes') {
      result = await this.docker.pruneVolumes({ filters: { all: ['true'] } });
    }

    return {
      success: true,
      reclaimedBytes: result?.SpaceReclaimed || 0
    };
  }

  public async getImages() {
    const data = await this.docker.listImages({ all: false });
    return this.validateApiData<any[]>(data);
  }

  public async getVolumes() {
    const data = await this.docker.listVolumes();
    const validated = this.validateApiData<any>(data);
    return validated.Volumes || [];
  }

  public async getNetworks() {
    const data = await this.docker.listNetworks();
    return this.validateApiData<any[]>(data);
  }

  public async removeImage(id: string) {
    const image = this.docker.getImage(id);
    await image.remove({ force: true });
  }

  public async removeVolume(name: string) {
    const volume = this.docker.getVolume(name);
    await volume.remove({ force: true });
  }

  public async removeNetwork(id: string) {
    const network = this.docker.getNetwork(id);
    await network.remove({ force: true });
  }

  public async getRunningContainers() {
    const containers = await this.docker.listContainers({ all: false });
    return this.validateApiData<any[]>(containers);
  }

  public async getAllContainers() {
    const containers = await this.docker.listContainers({ all: true });
    return this.validateApiData<any[]>(containers);
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
        Publishers?: { URL?: string, TargetPort?: number, PublishedPort?: number }[];
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
        return containers.map((c) => {
          let Ports: { PrivatePort: number, PublicPort: number }[] = [];
          if (c.Publishers && Array.isArray(c.Publishers)) {
            Ports = c.Publishers
              .filter(p => typeof p.PublishedPort === 'number' && p.PublishedPort > 0)
              .map(p => ({ PrivatePort: (p.TargetPort || 0) as number, PublicPort: p.PublishedPort as number }));
          }
          return {
            Id: c.ID || '',
            Names: ['/' + (c.Name || '')],  // Add leading slash to match Dockerode format
            State: c.State || 'unknown',
            Status: c.Status || '',
            Ports
          };
        });
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
      return fallbackContainers.map(c => {
        let Ports: { PrivatePort: number, PublicPort: number }[] = [];
        if (c.Ports && Array.isArray(c.Ports)) {
          Ports = c.Ports
            .filter((p: any) => typeof p.PublicPort === 'number' && p.PublicPort > 0)
            .map((p: any) => ({ PrivatePort: (p.PrivatePort || 0) as number, PublicPort: p.PublicPort as number }));
        }
        return {
          Id: c.Id,
          Names: c.Names,
          State: c.State,
          Status: c.Status,
          Ports
        };
      });
    } catch (fallbackError) {
      console.error(`Smart Fallback failed for ${stackName}:`, fallbackError);
      return [];
    }
  }

  public async streamContainerLogs(containerId: string, req: any, res: any): Promise<void> {
    const container = this.docker.getContainer(containerId);

    // 1. Set SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 100 // Send the last 100 lines immediately for context
      });

      // 2. Process and forward the stream
      logStream.on('data', (chunk: Buffer) => {
        // Docker multiplexes stdout/stderr with an 8-byte header if TTY is false.
        let data = chunk;
        if (chunk.length > 8 && (chunk[0] === 1 || chunk[0] === 2)) {
          data = chunk.slice(8);
        }

        const text = data.toString('utf-8');
        const lines = text.split('\n');

        lines.forEach(line => {
          if (line.trim()) {
            res.write(`data: ${JSON.stringify(line)}\n\n`);
          }
        });
      });

      // 3. Cleanup on disconnect
      req.on('close', () => {
        (logStream as any).destroy();
      });

    } catch (error: any) {
      res.write(`data: ${JSON.stringify('[Sencho] Error fetching logs: ' + error.message)}\n\n`);
      res.end();
    }
  }

  // State-safe: silently ignores 304 "already started" errors
  public async startContainer(containerId: string) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();
    } catch (error: any) {
      if (error?.statusCode === 304) {
        // Container already running - not an error
        return;
      }
      throw error;
    }
  }

  // State-safe: silently ignores 304 "already stopped" errors
  public async stopContainer(containerId: string) {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop();
    } catch (error: any) {
      if (error?.statusCode === 304) {
        // Container already stopped - not an error
        return;
      }
      throw error;
    }
  }

  public async restartContainer(containerId: string) {
    const container = this.docker.getContainer(containerId);
    await container.restart();
  }

  public async getOrphanContainers(knownStackNames: string[]) {
    // 1. Fetch all containers (running and stopped)
    const allContainers = await this.docker.listContainers({ all: true });

    // 2. Filter and categorize orphans
    const orphans: Record<string, any[]> = {};

    allContainers.forEach((container) => {
      // Look for the docker compose project label
      const projectName = container.Labels?.['com.docker.compose.project'];

      // If it has a project label, but the project is NOT in our known list...
      if (projectName && !knownStackNames.includes(projectName)) {
        if (!orphans[projectName]) {
          orphans[projectName] = [];
        }
        orphans[projectName].push({
          Id: container.Id,
          Names: container.Names,
          State: container.State,
          Status: container.Status,
          Image: container.Image
        });
      }
    });

    return orphans;
  }

  public async removeContainers(containerIds: string[]) {
    const results = [];
    for (const id of containerIds) {
      try {
        const container = this.docker.getContainer(id);
        await container.remove({ force: true });
        results.push({ id, success: true });
      } catch (error: any) {
        console.error(`Failed to remove container ${id}:`, error.message);
        results.push({ id, success: false, error: error.message });
      }
    }
    return results;
  }

  public async streamStats(containerId: string, ws: WebSocket) {
    const container = this.docker.getContainer(containerId);
    const stats = await container.stats({ stream: true });

    stats.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk.toString());
      }
    });

    stats.on('error', (err: Error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ error: err.message }));
      }
    });

    stats.on('end', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ end: true }));
      }
    });

    // Destroy the Docker stats stream when the WebSocket closes to prevent
    // orphaned streams polling the daemon after client disconnect.
    ws.on('close', () => {
      try { (stats as any).destroy(); } catch { /* stream already ended */ }
    });
  }

  public async getContainerStatsStream(containerId: string): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });
    return typeof stats === 'string' ? stats : JSON.stringify(stats);
  }

  /**
   * Exec into a container with full session isolation.
   * All state (exec instance, stream) lives in this closure - no singleton traps.
   * The WebSocket message handler is registered here to handle input, resize, and cleanup.
   */
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

      const stream = await exec.start({ hijack: true, stdin: true });

      // --- Downstream: container output → client ---
      stream.on('data', (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk.toString());
        }
      });

      stream.on('error', (err: Error) => {
        console.error('Exec stream error:', err.message);
      });

      stream.on('end', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });

      // --- Upstream: client messages → container ---
      ws.on('message', (raw: WebSocket.Data) => {
        try {
          const msg = JSON.parse(raw.toString());

          switch (msg.type) {
            case 'input':
              if (msg.data) {
                stream.write(msg.data);
              }
              break;

            case 'resize':
              if (msg.rows && msg.cols) {
                exec.resize({ h: msg.rows, w: msg.cols }).catch(() => {
                  // Ignore resize errors (exec may have ended)
                });
              }
              break;

            case 'ping':
              // Keep-alive, no-op
              break;
          }
        } catch {
          // Non-JSON or malformed message - ignore
        }
      });

      // --- Cleanup: prevent zombie processes ---
      ws.on('close', () => {
        try {
          stream.destroy();
        } catch {
          // Ignore destroy errors
        }
      });

    } catch (error) {
      const err = error as Error;
      console.error('Failed to exec container:', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n\x1b[31mFailed to start shell: ${err.message}\x1b[0m\r\n`);
      }
    }
  }
}

export let globalDockerNetwork = { rxSec: 0, txSec: 0 };
let lastNetSum = { rx: 0, tx: 0, timestamp: Date.now() };

export const updateGlobalDockerNetwork = async () => {
  try {
    const nodeId = NodeRegistry.getInstance().getDefaultNodeId();
    const dockerController = DockerController.getInstance(nodeId);
    const containers = await dockerController.getRunningContainers();

    const statsResults = await Promise.allSettled(
      containers.map(c => dockerController.getContainerStatsStream(c.Id))
    );

    let currentRxSum = 0;
    let currentTxSum = 0;

    for (const result of statsResults) {
      if (result.status === 'fulfilled') {
        try {
          const stats = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
          if (stats.networks) {
            for (const [_, net] of Object.entries(stats.networks) as any) {
              currentRxSum += net.rx_bytes || 0;
              currentTxSum += net.tx_bytes || 0;
            }
          }
        } catch (e) {
          // ignore parsing errors
        }
      }
    }

    const now = Date.now();
    const timeDiffSeconds = (now - lastNetSum.timestamp) / 1000;

    if (timeDiffSeconds > 0) {
      const rxDelta = currentRxSum >= lastNetSum.rx ? currentRxSum - lastNetSum.rx : 0;
      const txDelta = currentTxSum >= lastNetSum.tx ? currentTxSum - lastNetSum.tx : 0;

      globalDockerNetwork.rxSec = rxDelta / timeDiffSeconds;
      globalDockerNetwork.txSec = txDelta / timeDiffSeconds;
    }

    lastNetSum = { rx: currentRxSum, tx: currentTxSum, timestamp: now };
  } catch (error) {
    console.error('Failed to update global docker network stats:', error);
  }
};

// Start the interval tracker
setInterval(updateGlobalDockerNetwork, 3000);

export default DockerController;
