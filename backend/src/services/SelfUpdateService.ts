import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import DockerController from './DockerController';
import { disableCapability } from './CapabilityRegistry';

const execFileAsync = promisify(execFile);

// Error file written by the helper container on a failed compose recreate.
// Must live under /app/data so both the helper (via host-path bind mount) and
// the NEW gateway process (which always mounts /app/data) can reach it.
const UPDATE_ERROR_FILE = '/app/data/.sencho-update-error';

interface ComposeContext {
  workingDir: string;
  configFiles: string;
  serviceName: string;
  imageName: string;
  dataDirHost: string | null;
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

      // Find the host path backing /app/data. The helper container will bind-mount
      // it at the same path so compose recreate errors can be persisted to a file
      // that survives the gateway's restart and is readable by the NEW process.
      const mounts = (info.Mounts ?? []) as Array<{ Source?: string; Destination?: string }>;
      const dataDirHost = mounts.find(m => m.Destination === '/app/data')?.Source ?? null;
      if (!dataDirHost) {
        console.log('[SelfUpdate] /app/data mount not found - update error recovery will be unavailable');
      }

      this.composeContext = { workingDir, configFiles, serviceName, imageName, dataDirHost };
      this.canSelfUpdate = true;
      console.log(`[SelfUpdate] Ready - service="${serviceName}" image="${imageName}" in ${workingDir}`);

      // Surface any error from a previous failed update attempt (persisted by
      // the helper container) so the new process can report it to the user.
      this.recoverPreviousError();
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

  /** Surfaces any error the helper container persisted before the previous
   *  gateway process died, then deletes the file. */
  private recoverPreviousError(): void {
    try {
      const content = fs.readFileSync(UPDATE_ERROR_FILE, 'utf8').trim();
      if (content) {
        this.lastUpdateError = content;
        console.error('[SelfUpdate] Recovered error from previous update attempt:', content);
      }
      fs.unlinkSync(UPDATE_ERROR_FILE);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[SelfUpdate] Failed to recover previous update error:', (error as Error).message);
      }
    }
  }

  async triggerUpdate(): Promise<void> {
    if (!this.composeContext) return;
    const { workingDir, configFiles, serviceName, imageName, dataDirHost } = this.composeContext;
    const env = { ...process.env, PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
    this.lastUpdateError = null;

    try { fs.unlinkSync(UPDATE_ERROR_FILE); } catch { /* absent is the steady state */ }

    // Async pull: a sync execFileSync blocks the event loop, which lets the frontend
    // overlay see a false "online" response between the pull finishing and the restart.
    console.log(`[SelfUpdate] Pulling latest image: ${imageName}...`);
    try {
      await execFileAsync('docker', ['pull', imageName], {
        env,
        timeout: 300_000, // 5 min max for pull
      });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string })?.stderr?.toString().trim();
      this.lastUpdateError = stderr || (error as Error).message;
      console.error('[SelfUpdate] Pull failed:', this.lastUpdateError);
      return;
    }

    // The main container cannot access the compose file at its host path,
    // so the helper bind-mounts the compose working directory from the host.
    // Run attached (no -d): if compose recreate fails before it kills us,
    // execFile's callback receives the helper's exit code + stderr directly.
    console.log(`[SelfUpdate] Spawning updater container... (last breath)`);
    const fFlags = configFiles.split(',').flatMap(f => ['-f', f.trim()]);

    // On failure, persist exit code + stderr to UPDATE_ERROR_FILE (host-mounted)
    // so the NEW gateway can read it after restart if we die mid-execution.
    const stderrTmp = '/tmp/_sencho_err';
    const composeCmd = [
      'sleep 3',
      ['docker compose', ...fFlags, 'up -d --force-recreate', serviceName, `2>${stderrTmp}`].join(' '),
      'ec=$?',
      `if [ $ec -ne 0 ]; then { echo "exit=$ec"; cat ${stderrTmp}; } > ${UPDATE_ERROR_FILE} 2>/dev/null; fi`,
      `cat ${stderrTmp} >&2 2>/dev/null`,
      'exit $ec',
    ].join('; ');

    const args = [
      'run', '--rm',
      '--user', 'root',
      '--entrypoint', 'sh',
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-v', `${workingDir}:${workingDir}:ro`,
      ...(dataDirHost ? ['-v', `${dataDirHost}:/app/data:rw`] : []),
      '-w', workingDir,
      imageName,
      '-c', composeCmd,
    ];

    // Callback may never fire on success (we die mid-call during recreate);
    // that is fine because the restart itself is the success signal.
    execFile('docker', args, { env }, (err, _stdout, stderr) => {
      if (err) {
        const stderrText = stderr?.toString().trim();
        this.lastUpdateError = stderrText || err.message || 'Helper container failed';
        console.error('[SelfUpdate] Helper container failed:', this.lastUpdateError);
      }
    });
    // No code after this point is guaranteed to run: the helper recreates this container.
  }
}

export default SelfUpdateService;
