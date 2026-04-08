import { execFileSync, execFile } from 'child_process';
import DockerController from './DockerController';
import { disableCapability } from './CapabilityRegistry';

interface ComposeContext {
  workingDir: string;
  configFiles: string;
  serviceName: string;
  imageName: string;
}

class SelfUpdateService {
  private static instance: SelfUpdateService;
  private canSelfUpdate = false;
  private composeContext: ComposeContext | null = null;
  private lastUpdateError: string | null = null;

  public static getInstance(): SelfUpdateService {
    if (!SelfUpdateService.instance) {
      SelfUpdateService.instance = new SelfUpdateService();
    }
    return SelfUpdateService.instance;
  }

  async initialize(): Promise<void> {
    const hostname = process.env.HOSTNAME;
    if (!hostname) {
      console.log('[SelfUpdate] HOSTNAME not set - self-update unavailable (not running in Docker?)');
      disableCapability('self-update');
      return;
    }

    try {
      const docker = DockerController.getInstance().getDocker();
      const container = docker.getContainer(hostname);
      const info = await container.inspect();
      const labels = info.Config?.Labels ?? {};

      const workingDir = labels['com.docker.compose.project.working_dir'];
      const configFiles = labels['com.docker.compose.project.config_files'];
      const serviceName = labels['com.docker.compose.service'];

      if (!workingDir || !configFiles || !serviceName) {
        console.log('[SelfUpdate] Container lacks Docker Compose labels - self-update unavailable');
        disableCapability('self-update');
        return;
      }

      // Verify docker compose CLI is available inside the container
      try {
        execFileSync('docker', ['compose', 'version'], { stdio: 'pipe', timeout: 5000 });
      } catch {
        console.log('[SelfUpdate] docker compose CLI not available in container');
        disableCapability('self-update');
        return;
      }

      // Read the container's own image name for direct docker pull
      const imageName = info.Config?.Image;
      if (!imageName) {
        console.log('[SelfUpdate] Could not determine container image name');
        disableCapability('self-update');
        return;
      }

      this.composeContext = { workingDir, configFiles, serviceName, imageName };
      this.canSelfUpdate = true;
      console.log(`[SelfUpdate] Ready - service="${serviceName}" image="${imageName}" in ${workingDir}`);
    } catch (error) {
      console.log('[SelfUpdate] Could not inspect own container - self-update unavailable:', (error as Error).message);
      disableCapability('self-update');
    }
  }

  isAvailable(): boolean {
    return this.canSelfUpdate;
  }

  /** Returns the error message from the last failed update attempt, or null. */
  getLastError(): string | null {
    return this.lastUpdateError;
  }

  /** Clears the stored update error (call after reading it). */
  clearLastError(): void {
    this.lastUpdateError = null;
  }

  triggerUpdate(): void {
    if (!this.composeContext) return;
    const { workingDir, configFiles, serviceName, imageName } = this.composeContext;
    const env = { ...process.env, PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
    this.lastUpdateError = null;

    // Step 1: Pull latest image directly (no compose file needed)
    console.log(`[SelfUpdate] Pulling latest image: ${imageName}...`);
    try {
      execFileSync('docker', ['pull', imageName], {
        env,
        stdio: 'pipe',
        timeout: 300_000, // 5 min max for pull
      });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer })?.stderr?.toString().trim();
      this.lastUpdateError = stderr || (error as Error).message;
      console.error('[SelfUpdate] Pull failed:', this.lastUpdateError);
      return;
    }

    // Step 2: Spawn a helper container to run docker compose recreate.
    // The main container cannot access the compose file because the host path
    // from Docker labels does not exist inside this container. The helper
    // explicitly mounts the compose working directory from the host, so the
    // compose file is accessible at the original path.
    console.log(`[SelfUpdate] Spawning updater container... (last breath)`);
    const fFlags = configFiles.split(',').flatMap(f => ['-f', f.trim()]);
    const composeCmd = ['sleep 3 && docker compose', ...fFlags, 'up -d --force-recreate', serviceName].join(' ');
    const args = [
      'run', '--rm', '-d',
      '--user', 'root',
      '--entrypoint', 'sh',
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${workingDir}:${workingDir}:ro`,
      '-w', workingDir,
      imageName,
      '-c', composeCmd,
    ];

    execFile('docker', args, { env });
    // Process will be killed by Docker during recreate; no code runs after this
  }
}

export default SelfUpdateService;
