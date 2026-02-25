import { promises as fs, Dirent } from 'fs';
import path from 'path';

export class FileSystemService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.COMPOSE_DIR || '/app/compose';
  }

  /**
   * Check if a directory contains a valid compose file
   */
  private async hasComposeFile(dir: string): Promise<boolean> {
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

    for (const file of composeFiles) {
      try {
        await fs.access(path.join(dir, file));
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
        await fs.access(filePath);
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
      const items = await fs.readdir(this.baseDir, { withFileTypes: true });
      const stackNames: string[] = [];

      for (const item of items) {
        if (!item.isDirectory()) continue;

        const stackDir = path.join(this.baseDir, item.name);
        const hasCompose = await this.hasComposeFile(stackDir);

        if (hasCompose) {
          stackNames.push(item.name);
        }
      }

      return stackNames;
    } catch (error) {
      console.error('Error reading stacks:', error);
      return [];
    }
  }

  /**
   * Get the content of a stack's compose file
   */
  async getStackContent(stackName: string): Promise<string> {
    try {
      const filePath = await this.getComposeFilePath(stackName);
      return await fs.readFile(filePath, 'utf-8');
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
      await fs.writeFile(filePath, content, 'utf-8');
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
      await fs.access(envPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the content of a stack's .env file
   */
  async getEnvContent(stackName: string): Promise<string> {
    const envPath = path.join(this.baseDir, stackName, '.env');
    try {
      return await fs.readFile(envPath, 'utf-8');
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
      await fs.writeFile(envPath, content, 'utf-8');
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
      await fs.access(stackDir);
      throw new Error(`Stack "${stackName}" already exists`);
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        throw error;
      }
      // Directory doesn't exist, proceed
    }

    // Create the directory
    await fs.mkdir(stackDir, { recursive: true });

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
      await fs.writeFile(composePath, boilerplate, 'utf-8');
      console.log('Stack created successfully:', stackName);
    } catch (error) {
      console.error('Error creating stack:', error);
      throw new Error(`Failed to create stack: ${stackName}`);
    }
  }

  /**
   * Delete a stack (entire directory and its contents)
   */
  async deleteStack(stackName: string): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);

    try {
      await fs.rm(stackDir, { recursive: true, force: true });
      console.log('Stack deleted successfully:', stackName);
    } catch (error) {
      console.error('Error deleting stack:', error);
      throw new Error(`Failed to delete stack: ${stackName}`);
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
        await fs.access(this.baseDir);
      } catch {
        console.log('Creating compose directory:', this.baseDir);
        await fs.mkdir(this.baseDir, { recursive: true });
        return; // No files to migrate in a new directory
      }

      const items = await fs.readdir(this.baseDir, { withFileTypes: true });

      for (const item of items) {
        // Only process .yml/.yaml files (skip directories and other files)
        if (!item.isFile()) continue;
        if (!item.name.endsWith('.yml') && !item.name.endsWith('.yaml')) continue;

        const stackName = item.name.replace(/\.(yml|yaml)$/, '');
        const stackDir = path.join(this.baseDir, stackName);

        // Check if target directory already exists
        try {
          await fs.access(stackDir);
          console.log(`Skipping migration for "${stackName}": directory already exists`);
          continue;
        } catch {
          // Directory doesn't exist, proceed with migration
        }

        console.log(`Migrating stack: ${stackName}`);

        // Create the stack directory
        await fs.mkdir(stackDir, { recursive: true });

        // Move compose file to new location (standardize on compose.yaml)
        const oldComposePath = path.join(this.baseDir, item.name);
        const newComposePath = path.join(stackDir, 'compose.yaml');
        await fs.rename(oldComposePath, newComposePath);

        // Move env file if it exists (old pattern: stackname.env)
        const oldEnvPath = path.join(this.baseDir, `${stackName}.env`);
        const newEnvPath = path.join(stackDir, '.env');
        try {
          await fs.access(oldEnvPath);
          await fs.rename(oldEnvPath, newEnvPath);
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