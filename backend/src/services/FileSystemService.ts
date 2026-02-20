import { promises as fs } from 'fs';
import path from 'path';

export class FileSystemService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.COMPOSE_DIR || path.join(process.cwd(), '..', 'mock_data', 'docker', 'compose');
  }

  async getStackFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.baseDir);
      return files.filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
    } catch (error) {
      console.error('Error reading stack files:', error);
      return [];
    }
  }

  async getStackContent(filename: string): Promise<string> {
    const filePath = path.join(this.baseDir, filename);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error('Error reading file:', error);
      throw new Error(`Failed to read file: ${filename}`);
    }
  }

  async saveStackContent(filename: string, content: string): Promise<void> {
    const filePath = path.join(this.baseDir, filename);
    console.log('Saving to path:', filePath);
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      console.log('File written successfully');
    } catch (error) {
      console.error('Error writing file:', error);
      throw new Error(`Failed to save file: ${filename}`);
    }
  }

  async envExists(filename: string): Promise<boolean> {
    const envFilename = filename.replace(/\.yml$/, '.env');
    const envPath = path.join(this.baseDir, envFilename);
    try {
      await fs.access(envPath);
      return true;
    } catch {
      return false;
    }
  }

  async getEnvContent(filename: string): Promise<string> {
    const envFilename = filename.replace(/\.yml$/, '.env');
    const envPath = path.join(this.baseDir, envFilename);
    try {
      return await fs.readFile(envPath, 'utf-8');
    } catch (error) {
      console.error('Error reading env file:', error);
      throw new Error(`Failed to read env file for: ${filename}`);
    }
  }

  async saveEnvContent(filename: string, content: string): Promise<void> {
    const envFilename = filename.replace(/\.yml$/, '.env');
    const envPath = path.join(this.baseDir, envFilename);
    console.log('Saving env to path:', envPath);
    try {
      await fs.writeFile(envPath, content, 'utf-8');
      console.log('Env file written successfully');
    } catch (error) {
      console.error('Error writing env file:', error);
      throw new Error(`Failed to save env file for: ${filename}`);
    }
  }

  async createStack(filename: string): Promise<void> {
    if (!filename.endsWith('.yml')) {
      throw new Error('Filename must end with .yml');
    }
    const filePath = path.join(this.baseDir, filename);
    const boilerplate = `version: '3.8'

services:
  # Add your services here
`;
    try {
      await fs.writeFile(filePath, boilerplate, 'utf-8');
      console.log('Stack file created successfully:', filename);
    } catch (error) {
      console.error('Error creating stack file:', error);
      throw new Error(`Failed to create stack file: ${filename}`);
    }
  }

  async deleteStack(filename: string): Promise<void> {
    const filePath = path.join(this.baseDir, filename);
    const envFilename = filename.replace(/\.yml$/, '.env');
    const envPath = path.join(this.baseDir, envFilename);
    try {
      await fs.unlink(filePath);
      console.log('Stack file deleted successfully:', filename);
      // Try to delete env file if it exists
      try {
        await fs.unlink(envPath);
        console.log('Associated env file deleted:', envFilename);
      } catch {
        // Env file doesn't exist, ignore
      }
    } catch (error) {
      console.error('Error deleting stack file:', error);
      throw new Error(`Failed to delete stack file: ${filename}`);
    }
  }
}