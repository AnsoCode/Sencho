import { promises as fs } from 'fs';
import { IFileAdapter } from './IFileAdapter';

export class LocalFileAdapter implements IFileAdapter {
  async access(filePath: string): Promise<void> {
    return fs.access(filePath);
  }
  async readdir(dirPath: string, options?: any): Promise<any[]> {
    return fs.readdir(dirPath, options);
  }
  async readFile(filePath: string, encoding: any): Promise<string> {
    const raw = await fs.readFile(filePath, encoding);
    return typeof raw === 'string' ? raw : raw.toString(encoding || 'utf-8');
  }
  async writeFile(filePath: string, content: string, encoding: any): Promise<void> {
    await fs.writeFile(filePath, content, encoding);
  }
  async mkdir(dirPath: string, options?: any): Promise<void> {
    await fs.mkdir(dirPath, options);
  }
  async rm(targetPath: string, options?: any): Promise<void> {
    return fs.rm(targetPath, options);
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    return fs.rename(oldPath, newPath);
  }
}
