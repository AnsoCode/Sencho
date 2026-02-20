import { promises as fs } from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';

interface AuthConfig {
  username: string;
  passwordHash: string;
}

export class ConfigService {
  private dataDir: string;
  private configPath: string;

  constructor() {
    this.dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    this.configPath = path.join(this.dataDir, 'sencho.json');
  }

  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch {
      // Directory already exists
    }
  }

  async needsSetup(): Promise<boolean> {
    try {
      const config = await this.readConfig();
      return !config || !config.username || !config.passwordHash;
    } catch {
      return true;
    }
  }

  async readConfig(): Promise<AuthConfig | null> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async saveConfig(username: string, password: string): Promise<void> {
    await this.ensureDataDir();
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const config: AuthConfig = { username, passwordHash };
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async validateCredentials(username: string, password: string): Promise<boolean> {
    const config = await this.readConfig();
    if (!config) return false;
    
    if (username !== config.username) return false;
    
    return await bcrypt.compare(password, config.passwordHash);
  }
}
