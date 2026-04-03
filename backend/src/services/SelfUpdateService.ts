import { execSync, exec } from 'child_process';
import DockerController from './DockerController';
import { disableCapability } from './CapabilityRegistry';

interface ComposeContext {
  workingDir: string;
  configFiles: string;
  serviceName: string;
}

class SelfUpdateService {
  private static instance: SelfUpdateService;
  private canSelfUpdate = false;
  private composeContext: ComposeContext | null = null;

  public static getInstance(): SelfUpdateService {
    if (!SelfUpdateService.instance) {
      SelfUpdateService.instance = new SelfUpdateService();
    }
    return SelfUpdateService.instance;
  }

  async initialize(): Promise<void> {
    const hostname = process.env.HOSTNAME;
    if (!hostname) {
      console.log('[SelfUpdate] HOSTNAME not set — self-update unavailable (not running in Docker?)');
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
        console.log('[SelfUpdate] Container lacks Docker Compose labels — self-update unavailable');
        disableCapability('self-update');
        return;
      }

      this.composeContext = { workingDir, configFiles, serviceName };
      this.canSelfUpdate = true;
      console.log(`[SelfUpdate] Ready — service="${serviceName}" in ${workingDir}`);
    } catch (error) {
      console.log('[SelfUpdate] Could not inspect own container — self-update unavailable:', (error as Error).message);
      disableCapability('self-update');
    }
  }

  isAvailable(): boolean {
    return this.canSelfUpdate;
  }

  triggerUpdate(): void {
    if (!this.composeContext) return;
    const { workingDir, configFiles, serviceName } = this.composeContext;
    const env = { ...process.env, PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };

    console.log(`[SelfUpdate] Pulling latest image for ${serviceName}...`);
    try {
      execSync(`docker compose -f ${configFiles} pull ${serviceName}`, {
        cwd: workingDir,
        env,
        stdio: 'pipe',
        timeout: 300_000, // 5 min max for pull
      });
    } catch (error) {
      console.error('[SelfUpdate] Pull failed:', (error as Error).message);
      return;
    }

    console.log(`[SelfUpdate] Recreating container for ${serviceName}... (last breath)`);
    exec(`docker compose -f ${configFiles} up -d --force-recreate ${serviceName}`, {
      cwd: workingDir,
      env,
    });
    // Process will be killed by Docker during recreate — no code runs after this
  }
}

export default SelfUpdateService;
