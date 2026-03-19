import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
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
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error deleting stack directory:', error.message);
        throw new Error(`Failed to delete stack directory: ${error.message}`);
      }
    }
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
}
