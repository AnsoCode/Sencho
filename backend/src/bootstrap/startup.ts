import type { Server } from 'http';
import { FileSystemService } from '../services/FileSystemService';
import { NodeRegistry } from '../services/NodeRegistry';
import { LicenseService } from '../services/LicenseService';
import SelfUpdateService from '../services/SelfUpdateService';
import { MonitorService } from '../services/MonitorService';
import { AutoHealService } from '../services/AutoHealService';
import { DockerEventManager } from '../services/DockerEventManager';
import TrivyService from '../services/TrivyService';
import { ImageUpdateService } from '../services/ImageUpdateService';
import { SchedulerService } from '../services/SchedulerService';
import { MfaService } from '../services/MfaService';
import { sweepStaleTempDirs as sweepStaleGitTempDirs } from '../services/GitSourceService';
import { PORT } from '../helpers/constants';

/**
 * Run the startup sequence: stack-directory migration, service initialization,
 * background watchdogs, then bind the HTTP server. The caller passes the
 * already-constructed server so tests can import the module without binding a
 * port.
 */
export async function startServer(server: Server): Promise<void> {
  try {
    console.log('Running stack migration check...');
    const defaultFsService = FileSystemService.getInstance(NodeRegistry.getInstance().getDefaultNodeId());
    await defaultFsService.migrateFlatToDirectory();
    console.log('Migration check completed');
  } catch (error) {
    console.error('Migration failed:', error);
  }

  LicenseService.getInstance().initialize();

  await SelfUpdateService.getInstance().initialize();

  MonitorService.getInstance().start();
  AutoHealService.getInstance().start();

  await DockerEventManager.getInstance().start();

  await TrivyService.getInstance().initialize();

  ImageUpdateService.getInstance().start();

  SchedulerService.getInstance().start();

  sweepStaleGitTempDirs().catch((err) => {
    console.warn('[GitSource] Temp dir sweep failed:', (err as Error).message);
  });

  MfaService.getInstance().start();

  const isPilotAgent = process.env.SENCHO_MODE === 'pilot';
  const listenHost = isPilotAgent ? '127.0.0.1' : undefined;

  server.listen(PORT, listenHost, () => {
    console.log(`Server running on ${listenHost || '0.0.0.0'}:${PORT}${isPilotAgent ? ' (pilot-agent mode)' : ''}`);
    if (isPilotAgent) {
      import('../pilot/agent').then((m) => m.startPilotAgent(PORT)).catch((err) => {
        console.error('[Pilot] Agent startup failed:', err);
      });
    }
  });
}
