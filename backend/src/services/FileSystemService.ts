import path from 'path';
import { IFileAdapter } from './fs/IFileAdapter';
import { LocalFileAdapter } from './fs/LocalFileAdapter';
import { SSHFileAdapter } from './fs/SSHFileAdapter';
import { NodeRegistry } from './NodeRegistry';

export class FileSystemService {
  private baseDir: string;
  private adapter: IFileAdapter;
  private nodeId: number;

  constructor(nodeId?: number) {
    this.nodeId = nodeId ?? NodeRegistry.getInstance().getDefaultNodeId();

    const node = NodeRegistry.getInstance().getNode(this.nodeId);

    if (!node || node.type === 'local' || !node.host) {
      this.baseDir = process.env.COMPOSE_DIR || '/app/compose';
      this.adapter = new LocalFileAdapter();
    } else {
      this.baseDir = node.compose_dir;
      if (!this.baseDir || typeof this.baseDir !== 'string' || this.baseDir.trim() === '') {
        throw new Error(`Remote node "${node.name}" has no compose_dir configured. Please set a compose directory in the Node Manager.`);
      }
      this.adapter = new SSHFileAdapter(node);
    }
  }

  public static getInstance(nodeId?: number): FileSystemService {
    return new FileSystemService(nodeId);
  }

  /**
   * Check if a directory contains a valid compose file
   */
  private async hasComposeFile(dir: string): Promise<boolean> {
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

    for (const file of composeFiles) {
      try {
        await this.adapter.access(path.join(dir, file));
        return true;
      } catch {
        // Continue checking other options
      }
    }

    return false;
  }

  /**
   * Get the path to the compose file for a stack
   * Throws if no compose file is found
   */
  private async getComposeFilePath(stackName: string): Promise<string> {
    const stackDir = path.join(this.baseDir, stackName);
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

    for (const file of composeFiles) {
      const filePath = path.join(stackDir, file);
      try {
        await this.adapter.access(filePath);
        return filePath;
      } catch {
        // Continue checking other options
      }
    }

    throw new Error(`No compose file found for stack: ${stackName}`);
  }

  /**
   * Get all stacks (directories containing compose files)
   * Returns array of stack names (directory names)
   */
  async getStacks(): Promise<string[]> {
    try {
      const items = await this.adapter.readdir(this.baseDir, { withFileTypes: true });
      const stackNames: string[] = [];

      for (const item of items) {
        if (!item.isDirectory()) continue;
        if (!item.name || typeof item.name !== 'string') continue;

        const stackDir = path.join(this.baseDir, item.name);
        const hasCompose = await this.hasComposeFile(stackDir);

        if (hasCompose) {
          stackNames.push(item.name);
        }
      }

      return stackNames;
    } catch (error: any) {
      const nodeName = NodeRegistry.getInstance().getNode(this.nodeId)?.name || 'Unknown';
      console.warn(`[SFTP] Failed to fetch stacks for Node ${nodeName}: ${error.message || error}`);
      return [];
    }
  }

  /**
   * Get the content of a stack's compose file
   */
  async getStackContent(stackName: string): Promise<string> {
    try {
      const filePath = await this.getComposeFilePath(stackName);
      return await this.adapter.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error('Error reading stack content:', error);
      throw new Error(`Failed to read stack: ${stackName}`);
    }
  }

  /**
   * Save content to a stack's compose file
   * Always writes to compose.yaml (standardizing on this filename)
   */
  async saveStackContent(stackName: string, content: string): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);
    const filePath = path.join(stackDir, 'compose.yaml');

    console.log('Saving to path:', filePath);

    try {
      await this.adapter.writeFile(filePath, content, 'utf-8');
      console.log('File written successfully');
    } catch (error) {
      console.error('Error writing file:', error);
      throw new Error(`Failed to save stack: ${stackName}`);
    }
  }

  /**
   * Check if a stack has an .env file
   */
  async envExists(stackName: string): Promise<boolean> {
    const envPath = path.join(this.baseDir, stackName, '.env');
    try {
      await this.adapter.access(envPath);
      return true;
    } catch {
      return false;
    }
  }

  // Proxy to adapter read/write operations for use in other services and generic routes
  
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    return this.adapter.readFile(filePath, encoding);
  }

  async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): Promise<void> {
    return this.adapter.writeFile(filePath, content, encoding);
  }

  async access(filePath: string): Promise<void> {
    return this.adapter.access(filePath);
  }

  /**
   * Get the content of a stack's .env file
   */
  async getEnvContent(stackName: string): Promise<string> {
    const envPath = path.join(this.baseDir, stackName, '.env');
    try {
      return await this.adapter.readFile(envPath, 'utf-8');
    } catch (error) {
      console.error('Error reading env file:', error);
      throw new Error(`Failed to read env file for stack: ${stackName}`);
    }
  }

  /**
   * Save content to a stack's .env file
   */
  async saveEnvContent(stackName: string, content: string): Promise<void> {
    const envPath = path.join(this.baseDir, stackName, '.env');
    console.log('Saving env to path:', envPath);

    try {
      await this.adapter.writeFile(envPath, content, 'utf-8');
      console.log('Env file written successfully');
    } catch (error) {
      console.error('Error writing env file:', error);
      throw new Error(`Failed to save env file for stack: ${stackName}`);
    }
  }

  /**
   * Create a new stack (directory with boilerplate compose.yaml)
   */
  async createStack(stackName: string): Promise<void> {
    // Validate stack name (no special characters, not empty)
    if (!stackName || !/^[a-zA-Z0-9_-]+$/.test(stackName)) {
      throw new Error('Stack name must contain only alphanumeric characters, underscores, or hyphens');
    }

    const stackDir = path.join(this.baseDir, stackName);

    // Check if directory already exists
    try {
      await this.adapter.access(stackDir);
      throw new Error(`Stack "${stackName}" already exists`);
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        throw error;
      }
      // Directory doesn't exist, proceed
    }

    // Create the directory
    await this.adapter.mkdir(stackDir, { recursive: true });

    // Write boilerplate compose.yaml
    const composePath = path.join(stackDir, 'compose.yaml');
    const boilerplate = `services:
  app:
    image: nginx:latest
    ports:
      - "8080:80"
    restart: always
`;
    try {
      await this.adapter.writeFile(composePath, boilerplate, 'utf-8');
      console.log('Stack created successfully:', stackName);
    } catch (error) {
      console.error('Error creating stack:', error);
      throw new Error(`Failed to create stack: ${stackName}`);
    }
  }

  /**
   * Delete a stack (entire directory and its contents)
   */
  public async deleteStack(stackName: string): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);

    try {
      await this.adapter.rm(stackDir, { recursive: true, force: true });
      console.log('Stack deleted successfully:', stackName);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error deleting stack directory:', error.message);
        throw new Error(`Failed to delete stack directory: ${error.message}`);
      }
    }
  }

  /**
   * Get the base directory path for stacks
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Migrate existing flat-file stacks to directory-based structure
   * This runs automatically on server startup
   */
  async migrateFlatToDirectory(): Promise<void> {
    try {
      // Ensure base directory exists
      try {
        await this.adapter.access(this.baseDir);
      } catch {
        console.log('Creating compose directory:', this.baseDir);
        await this.adapter.mkdir(this.baseDir, { recursive: true });
        return; // No files to migrate in a new directory
      }

      const items = await this.adapter.readdir(this.baseDir, { withFileTypes: true });

      for (const item of items) {
        // Only process .yml/.yaml files (skip directories and other files)
        if (!item.isFile()) continue;
        if (!item.name.endsWith('.yml') && !item.name.endsWith('.yaml')) continue;

        const stackName = item.name.replace(/\.(yml|yaml)$/, '');
        const stackDir = path.join(this.baseDir, stackName);

        // Check if target directory already exists
        try {
          await this.adapter.access(stackDir);
          console.log(`Skipping migration for "${stackName}": directory already exists`);
          continue;
        } catch {
          // Directory doesn't exist, proceed with migration
        }

        console.log(`Migrating stack: ${stackName}`);

        // Create the stack directory
        await this.adapter.mkdir(stackDir, { recursive: true });

        // Move compose file to new location (standardize on compose.yaml)
        const oldComposePath = path.join(this.baseDir, item.name);
        const newComposePath = path.join(stackDir, 'compose.yaml');
        await this.adapter.rename(oldComposePath, newComposePath);

        // Move env file if it exists (old pattern: stackname.env)
        const oldEnvPath = path.join(this.baseDir, `${stackName}.env`);
        const newEnvPath = path.join(stackDir, '.env');
        try {
          await this.adapter.access(oldEnvPath);
          await this.adapter.rename(oldEnvPath, newEnvPath);
          console.log(`Migrated env file for: ${stackName}`);
        } catch {
          // No env file to migrate, that's fine
        }

        console.log(`Successfully migrated stack: ${stackName}`);
      }
    } catch (error) {
      console.error('Migration error:', error);
      // Don't throw - allow the server to start even if migration fails
    }
  }
}