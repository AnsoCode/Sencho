import path from 'path';
import { promises as fsPromises } from 'fs';
import { spawn } from 'child_process';
import { NodeRegistry } from './NodeRegistry';

/**
 * FileSystemService - local-only file I/O for compose stack management.
 *
 * In the Distributed API model, remote node file operations are handled
 * by the remote Sencho instance itself. This service only operates on
 * the local filesystem.
 */
export class FileSystemService {
  private baseDir: string;

  constructor(nodeId?: number) {
    this.baseDir = NodeRegistry.getInstance().getComposeDir(
      nodeId ?? NodeRegistry.getInstance().getDefaultNodeId()
    );
  }

  public static getInstance(nodeId?: number): FileSystemService {
    return new FileSystemService(nodeId);
  }

  private async hasComposeFile(dir: string): Promise<boolean> {
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
    for (const file of composeFiles) {
      try {
        await fsPromises.access(path.join(dir, file));
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  private async getComposeFilePath(stackName: string): Promise<string> {
    const stackDir = path.join(this.baseDir, stackName);
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
    for (const file of composeFiles) {
      const filePath = path.join(stackDir, file);
      try {
        await fsPromises.access(filePath);
        return filePath;
      } catch {
        // continue
      }
    }
    throw new Error(`No compose file found for stack: ${stackName}`);
  }

  async getStacks(): Promise<string[]> {
    try {
      const items = await fsPromises.readdir(this.baseDir, { withFileTypes: true });
      const stackNames: string[] = [];

      for (const item of items) {
        if (!item.isDirectory()) continue;
        if (!item.name || typeof item.name !== 'string') continue;

        const stackDir = path.join(this.baseDir, item.name);
        if (await this.hasComposeFile(stackDir)) {
          stackNames.push(item.name);
        }
      }

      return stackNames;
    } catch (error: any) {
      console.warn(`[FileSystemService] Failed to list stacks: ${error.message}`);
      return [];
    }
  }

  async getStackContent(stackName: string): Promise<string> {
    try {
      const filePath = await this.getComposeFilePath(stackName);
      return await fsPromises.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error('Error reading stack content:', error);
      throw new Error(`Failed to read stack: ${stackName}`);
    }
  }

  async saveStackContent(stackName: string, content: string): Promise<void> {
    const filePath = path.join(this.baseDir, stackName, 'compose.yaml');
    console.log('Saving to path:', filePath);
    try {
      await fsPromises.writeFile(filePath, content, 'utf-8');
      console.log('File written successfully');
    } catch (error) {
      console.error('Error writing file:', error);
      throw new Error(`Failed to save stack: ${stackName}`);
    }
  }

  async envExists(stackName: string): Promise<boolean> {
    try {
      await fsPromises.access(path.join(this.baseDir, stackName, '.env'));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    return fsPromises.readFile(filePath, encoding);
  }

  async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    return fsPromises.writeFile(filePath, content, encoding);
  }

  async access(filePath: string): Promise<void> {
    return fsPromises.access(filePath);
  }

  async getEnvContent(stackName: string): Promise<string> {
    const envPath = path.join(this.baseDir, stackName, '.env');
    try {
      return await fsPromises.readFile(envPath, 'utf-8');
    } catch (error) {
      console.error('Error reading env file:', error);
      throw new Error(`Failed to read env file for stack: ${stackName}`);
    }
  }

  async saveEnvContent(stackName: string, content: string): Promise<void> {
    const envPath = path.join(this.baseDir, stackName, '.env');
    console.log('Saving env to path:', envPath);
    try {
      await fsPromises.writeFile(envPath, content, 'utf-8');
      console.log('Env file written successfully');
    } catch (error) {
      console.error('Error writing env file:', error);
      throw new Error(`Failed to save env file for stack: ${stackName}`);
    }
  }

  async createStack(stackName: string): Promise<void> {
    if (!stackName || !/^[a-zA-Z0-9_-]+$/.test(stackName)) {
      throw new Error('Stack name must contain only alphanumeric characters, underscores, or hyphens');
    }

    const stackDir = path.join(this.baseDir, stackName);

    try {
      await fsPromises.access(stackDir);
      throw new Error(`Stack "${stackName}" already exists`);
    } catch (error: any) {
      if (error.message.includes('already exists')) throw error;
    }

    await fsPromises.mkdir(stackDir, { recursive: true });

    const boilerplate = `services:
  app:
    image: nginx:latest
    ports:
      - "8080:80"
    restart: always
`;
    try {
      await fsPromises.writeFile(path.join(stackDir, 'compose.yaml'), boilerplate, 'utf-8');
      console.log('Stack created successfully:', stackName);
    } catch (error) {
      console.error('Error creating stack:', error);
      throw new Error(`Failed to create stack: ${stackName}`);
    }
  }

  public async deleteStack(stackName: string): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    try {
      await fsPromises.rm(stackDir, { recursive: true, force: true });
      console.log('Stack deleted successfully:', stackName);
    } catch (error: unknown) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') return;

      if (fsError.code === 'EACCES' || fsError.code === 'EPERM') {
        console.warn(
          `[FileSystemService] Permission denied deleting ${stackName}, falling back to Docker-based removal`
        );
        await this.forceDeleteViaDocker(stackDir);
        // Docker removes contents but can't remove its own mount point; clean up the empty shell
        try {
          await fsPromises.rmdir(stackDir);
        } catch {
          console.warn(`[FileSystemService] Could not remove empty directory ${stackDir} — may need manual cleanup`);
        }
        console.log('Stack deleted successfully (via Docker fallback):', stackName);
      } else {
        console.error('Error deleting stack directory:', fsError.message);
        throw new Error(`Failed to delete stack directory: ${fsError.message}`);
      }
    }
  }

  private forceDeleteViaDocker(dirPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = 30_000;
      const child = spawn('docker', [
        'run', '--rm',
        '-v', `${dirPath}:/cleanup`,
        'alpine',
        'rm', '-rf', '/cleanup'
      ], {
        env: {
          ...process.env,
          PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        }
      });

      let stderr = '';
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(
          `Docker-based deletion timed out after 30s. You may need to manually remove the directory: ${dirPath}`
        ));
      }, timeout);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(
          `Failed to delete stack directory — Docker cleanup exited with code ${code}. ` +
          `You may need to manually remove the directory: ${dirPath}`
        ));
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(new Error(
          `Failed to delete stack directory — could not run Docker for cleanup: ${err.message}. ` +
          `You may need to manually remove the directory: ${dirPath}`
        ));
      });
    });
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  async migrateFlatToDirectory(): Promise<void> {
    try {
      try {
        await fsPromises.access(this.baseDir);
      } catch {
        console.log('Creating compose directory:', this.baseDir);
        await fsPromises.mkdir(this.baseDir, { recursive: true });
        return;
      }

      const items = await fsPromises.readdir(this.baseDir, { withFileTypes: true });

      for (const item of items) {
        if (!item.isFile()) continue;
        if (!item.name.endsWith('.yml') && !item.name.endsWith('.yaml')) continue;

        const stackName = item.name.replace(/\.(yml|yaml)$/, '');
        const stackDir = path.join(this.baseDir, stackName);

        try {
          await fsPromises.access(stackDir);
          console.log(`Skipping migration for "${stackName}": directory already exists`);
          continue;
        } catch {
          // Directory doesn't exist, proceed
        }

        console.log(`Migrating stack: ${stackName}`);
        await fsPromises.mkdir(stackDir, { recursive: true });

        const oldComposePath = path.join(this.baseDir, item.name);
        const newComposePath = path.join(stackDir, 'compose.yaml');
        await fsPromises.rename(oldComposePath, newComposePath);

        const oldEnvPath = path.join(this.baseDir, `${stackName}.env`);
        const newEnvPath = path.join(stackDir, '.env');
        try {
          await fsPromises.access(oldEnvPath);
          await fsPromises.rename(oldEnvPath, newEnvPath);
          console.log(`Migrated env file for: ${stackName}`);
        } catch {
          // No env file to migrate
        }

        console.log(`Successfully migrated stack: ${stackName}`);
      }
    } catch (error) {
      console.error('Migration error:', error);
    }
  }

  /**
   * Backup stack files (compose.yaml + .env) to .sencho-backup/ within the stack dir.
   */
  async backupStackFiles(stackName: string): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    const backupDir = path.join(stackDir, '.sencho-backup');
    await fsPromises.mkdir(backupDir, { recursive: true });

    // Copy compose file
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
    for (const file of composeFiles) {
      const src = path.join(stackDir, file);
      try {
        await fsPromises.access(src);
        await fsPromises.copyFile(src, path.join(backupDir, file));
      } catch {
        // File doesn't exist, skip
      }
    }

    // Copy .env if it exists
    const envSrc = path.join(stackDir, '.env');
    try {
      await fsPromises.access(envSrc);
      await fsPromises.copyFile(envSrc, path.join(backupDir, '.env'));
    } catch {
      // No .env to backup
    }

    // Write timestamp marker
    await fsPromises.writeFile(path.join(backupDir, '.timestamp'), Date.now().toString(), 'utf-8');
  }

  /**
   * Restore stack files from .sencho-backup/ back to the stack dir.
   */
  async restoreStackFiles(stackName: string): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    const backupDir = path.join(stackDir, '.sencho-backup');

    const items = await fsPromises.readdir(backupDir);
    for (const item of items) {
      if (item === '.timestamp') continue;
      await fsPromises.copyFile(path.join(backupDir, item), path.join(stackDir, item));
    }
  }

  /**
   * Get backup info for a stack.
   */
  async getBackupInfo(stackName: string): Promise<{ exists: boolean; timestamp: number | null }> {
    const backupDir = path.join(this.baseDir, stackName, '.sencho-backup');
    try {
      await fsPromises.access(backupDir);
      const tsFile = path.join(backupDir, '.timestamp');
      try {
        const ts = await fsPromises.readFile(tsFile, 'utf-8');
        return { exists: true, timestamp: parseInt(ts, 10) || null };
      } catch {
        return { exists: true, timestamp: null };
      }
    } catch {
      return { exists: false, timestamp: null };
    }
  }
}
