import Client from 'ssh2-sftp-client';
import { IFileAdapter } from './IFileAdapter';
import { Node } from '../DatabaseService';

export class SSHFileAdapter implements IFileAdapter {
  private node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  private async getClient() {
    const sftp = new Client();
    await sftp.connect({
      host: this.node.host,
      port: this.node.ssh_port || 22,
      username: this.node.ssh_user!,
      password: this.node.ssh_password,
      privateKey: this.node.ssh_key,
      readyTimeout: 10000,
    });
    return sftp;
  }

  async access(filePath: string): Promise<void> {
    const sftp = await this.getClient();
    try {
      const exists = await sftp.exists(filePath);
      if (!exists) throw Object.assign(new Error(), { code: 'ENOENT' });
    } finally {
      await sftp.end();
    }
  }

  async readdir(dirPath: string, options?: any): Promise<any[]> {
    const sftp = await this.getClient();
    try {
      const list = await sftp.list(dirPath);
      if (options?.withFileTypes) {
        return list.map((item: any) => ({
          name: item.name,
          isDirectory: () => item.type === 'd',
          isFile: () => item.type === '-',
        }));
      }
      return list.map((item: any) => item.name);
    } catch(err: any) {
        if(err.code === 2 || err.message.includes('No such file')) throw Object.assign(new Error(), { code: 'ENOENT' });
        throw err;
    } finally {
      await sftp.end();
    }
  }

  async readFile(filePath: string, encoding: any): Promise<string> {
    const sftp = await this.getClient();
    try {
      const buffer = await sftp.get(filePath);
      if (Buffer.isBuffer(buffer)) {
         return buffer.toString(encoding as BufferEncoding);
      }
      return buffer as unknown as string;
    } catch(err: any) {
        if(err.code === 2 || err.message.includes('No such file')) throw Object.assign(new Error(), { code: 'ENOENT' });
        throw err;
    } finally {
      await sftp.end();
    }
  }

  async writeFile(filePath: string, content: string, encoding: any): Promise<void> {
    const sftp = await this.getClient();
    try {
        await sftp.put(Buffer.from(content, encoding as BufferEncoding), filePath);
    } finally {
      await sftp.end();
    }
  }

  async mkdir(dirPath: string, options?: any): Promise<void> {
    const sftp = await this.getClient();
    try {
      const exists = await sftp.exists(dirPath);
      if (!exists) {
        await sftp.mkdir(dirPath, options?.recursive);
      }
    } finally {
      await sftp.end();
    }
  }

  async rm(targetPath: string, options?: any): Promise<void> {
    const sftp = await this.getClient();
    try {
      const type = await sftp.exists(targetPath);
      if (type === 'd') {
        await sftp.rmdir(targetPath, options?.recursive);
      } else if (type === '-') {
        await sftp.delete(targetPath);
      } else if (!options?.force) {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      }
    } catch(err: any) {
        if(err.code === 2 || err.message.includes('No such file')) {
            if (options?.force) return;
            throw Object.assign(new Error(), { code: 'ENOENT' });
        }
        throw err;
    } finally {
      await sftp.end();
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getClient();
    try {
      await sftp.rename(oldPath, newPath);
    } finally {
      await sftp.end();
    }
  }
}
