import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import DockerController, { globalDockerNetwork } from './services/DockerController';
import { FileSystemService } from './services/FileSystemService';
import { ComposeService } from './services/ComposeService';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore - composerize lacks proper type definitions
import composerize from 'composerize';
import si from 'systeminformation';
import http from 'http';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { HostTerminalService } from './services/HostTerminalService';
import { DatabaseService } from './services/DatabaseService';
import { NotificationService } from './services/NotificationService';
import { MonitorService } from './services/MonitorService';
import YAML from 'yaml';
import { promises as fsPromises } from 'fs';

const execAsync = promisify(exec);

const app = express();
const PORT = 3000;

// FileSystemService for stack management
const fileSystemService = new FileSystemService();

// ComposeService for stack operations
const composeService = new ComposeService();

// Cookie settings
const COOKIE_NAME = 'sencho_token';

// Helper to determine if request is secure (HTTPS or behind a proxy that terminates SSL)
const isSecureRequest = (req: Request): boolean => {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
};

// Helper to get cookie options dynamically per-request
const getCookieOptions = (req: Request) => ({
  httpOnly: true,
  secure: isSecureRequest(req),
  sameSite: 'strict' as const,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
});

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Extend Express Request type for user
declare module 'express' {
  interface Request {
    user?: { username: string };
  }
}

// Authentication Middleware
const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) throw new Error('No JWT secret');
    const decoded = jwt.verify(token, jwtSecret) as { username: string };
    req.user = { username: decoded.username };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
};

// Auth Routes (no authentication required)

// Check if setup is needed
app.get('/api/auth/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const needsSetup = !settings.auth_username || !settings.auth_password_hash || !settings.auth_jwt_secret;
    res.json({ needsSetup });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.json({ needsSetup: true });
  }
});

// Initial setup endpoint
app.post('/api/auth/setup', async (req: Request, res: Response): Promise<void> => {
  try {
    const dbSvc = DatabaseService.getInstance();
    const settings = dbSvc.getGlobalSettings();
    const needsSetup = !settings.auth_username || !settings.auth_password_hash || !settings.auth_jwt_secret;
    if (!needsSetup) {
      res.status(400).json({ error: 'Setup has already been completed' });
      return;
    }

    const { username, password, confirmPassword } = req.body;

    // Validation
    if (!username || !password || !confirmPassword) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (username.length < 3) {
      res.status(400).json({ error: 'Username must be at least 3 characters' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match' });
      return;
    }

    // Save credentials (this also generates the JWT secret)
    const passwordHash = await bcrypt.hash(password, 10);
    const jwtSecret = crypto.randomBytes(64).toString('hex');
    dbSvc.updateGlobalSetting('auth_username', username);
    dbSvc.updateGlobalSetting('auth_password_hash', passwordHash);
    dbSvc.updateGlobalSetting('auth_jwt_secret', jwtSecret);

    // Issue JWT and log user in
    const token = jwt.sign({ username }, jwtSecret, { expiresIn: '24h' });
    res.cookie(COOKIE_NAME, token, getCookieOptions(req));
    res.json({ success: true, message: 'Setup completed successfully' });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Failed to complete setup' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const storedUsername = settings.auth_username;
    const storedHash = settings.auth_password_hash;

    if (storedUsername && storedHash && username === storedUsername) {
      const isValid = await bcrypt.compare(password, storedHash);
      if (isValid) {
        const jwtSecret = settings.auth_jwt_secret;
        if (!jwtSecret) throw new Error('JWT secret missing from DB');
        const token = jwt.sign({ username }, jwtSecret, { expiresIn: '24h' });
        res.cookie(COOKIE_NAME, token, getCookieOptions(req));
        res.json({ success: true, message: 'Login successful' });
        return;
      }
    }

    res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Update password endpoint
app.put('/api/auth/password', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'Old password and new password are required' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' });
      return;
    }

    const dbSvc = DatabaseService.getInstance();
    const settings = dbSvc.getGlobalSettings();
    const storedHash = settings.auth_password_hash;

    if (!storedHash) {
      res.status(400).json({ error: 'Auth not configured properly' });
      return;
    }

    const isValid = await bcrypt.compare(oldPassword, storedHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid old password' });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    dbSvc.updateGlobalSetting('auth_password_hash', newHash);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response): void => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'strict',
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

// Check authentication status
app.get('/api/auth/check', authMiddleware, (req: Request, res: Response): void => {
  res.json({ authenticated: true, user: req.user });
});

// Apply authentication middleware to all /api/* routes except /api/auth/*
app.use('/api', (req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/auth/')) {
    next();
    return;
  }
  authMiddleware(req, res, next);
});

// Create HTTP server for WebSocket upgrade handling
const server = http.createServer(app);

// WebSocket server with authentication
const wss = new WebSocket.Server({ noServer: true });

let terminalWs: WebSocket | null = null;

// Handle WebSocket upgrade with JWT authentication
server.on('upgrade', async (req, socket, head) => {
  // Parse cookies from the upgrade request
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=')).filter(([k, v]) => k && v)
  );

  const token = cookies[COOKIE_NAME];

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    const jwtSecret = settings.auth_jwt_secret;
    if (!jwtSecret) throw new Error('No JWT secret');
    jwt.verify(token, jwtSecret);

    // Check if this is a stack logs WebSocket request
    const url = req.url || '';
    const logsMatch = url.match(/^\/api\/stacks\/([^/]+)\/logs$/);
    const hostConsoleMatch = url.match(/^\/api\/system\/host-console/);

    if (logsMatch) {
      // Dedicated stack logs WebSocket - uses Supervisor loop for persistent logs
      const logsWss = new WebSocket.Server({ noServer: true });
      logsWss.handleUpgrade(req, socket, head, (ws) => {
        const stackName = decodeURIComponent(logsMatch[1]);
        try {
          composeService.streamLogs(stackName, ws);
        } catch (error) {
          console.error('Failed to stream logs:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(`Error streaming logs: ${(error as Error).message}\n`);
          }
        }
      });
    } else if (hostConsoleMatch) {
      const hostConsoleWss = new WebSocket.Server({ noServer: true });
      hostConsoleWss.handleUpgrade(req, socket, head, (ws) => {
        let targetDirectory = fileSystemService.getBaseDir();
        try {
          const reqUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
          const stackParam = reqUrl.searchParams.get('stack');
          if (stackParam) {
            targetDirectory = path.join(targetDirectory, stackParam);
          }
        } catch (e) {
          // ignore parsing error, fallback to base dir
        }
        try {
          HostTerminalService.spawnTerminal(ws, targetDirectory);
        } catch (error) {
          console.error('Failed to spawn host terminal:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(`Error spawning terminal: ${(error as Error).message}\r\n`);
            ws.close();
          }
        }
      });
    } else {
      // Generic terminal WebSocket
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  } catch (error) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
});

wss.on('connection', (ws) => {
  console.log('WebSocket connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Only handle 'action'-based messages at the global level.
      // 'type'-based messages (input, resize, ping) are handled by the
      // per-session listener registered inside execContainer's closure.
      if (!data.action) return;

      if (data.action === 'connectTerminal') {
        terminalWs = ws;
      } else if (data.action === 'streamStats') {
        const dockerController = DockerController.getInstance();
        dockerController.streamStats(data.containerId, ws);
      } else if (data.action === 'execContainer') {
        // Handle container exec for bash access
        // Input, resize, and cleanup are handled inside execContainer's closure
        const dockerController = DockerController.getInstance();
        dockerController.execContainer(data.containerId, ws);
      }
    } catch (error) {
      // Malformed JSON — ignore silently
    }
  });
});

// API Routes (all protected by authMiddleware)

app.get('/api/containers', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getRunningContainers();
    res.json(containers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch containers' });
  }
});

// Stack Routes - Updated to use stackName (directory name) instead of filename

app.get('/api/stacks', async (req: Request, res: Response) => {
  try {
    const stacks = await fileSystemService.getStacks();
    res.json(stacks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stacks' });
  }
});

app.get('/api/stacks/:stackName', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const content = await fileSystemService.getStackContent(stackName);
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read stack' });
  }
});

app.put('/api/stacks/:stackName', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (stackName.includes('..') || stackName.includes('/') || stackName.includes('\\')) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const { content } = req.body;
    console.log('PUT /api/stacks/:stackName', { stackName, contentType: typeof content, contentLength: content?.length });
    if (typeof content !== 'string') {
      console.error('Content is not a string:', content);
      return res.status(400).json({ error: 'Content must be a string' });
    }
    await fileSystemService.saveStackContent(stackName, content);
    console.log('Stack saved successfully:', stackName);
    res.json({ message: 'Stack saved successfully' });
  } catch (error) {
    console.error('Failed to save stack:', error);
    res.status(500).json({ error: 'Failed to save stack' });
  }
});

// Helper: resolve all env file paths dynamically from compose.yaml's env_file field
async function resolveAllEnvFilePaths(stackName: string): Promise<string[]> {
  const stackDir = path.join(fileSystemService.getBaseDir(), stackName);
  const defaultEnvPath = path.join(stackDir, '.env');

  try {
    // Try to read and parse the compose file
    const composeFiles = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];
    let composeContent: string | null = null;

    for (const file of composeFiles) {
      try {
        composeContent = await fsPromises.readFile(path.join(stackDir, file), 'utf-8');
        break;
      } catch {
        // Try next file
      }
    }

    if (!composeContent) return [defaultEnvPath];

    const parsed = YAML.parse(composeContent);
    if (!parsed?.services) return [defaultEnvPath];

    const envFiles = new Set<string>();

    // Iterate through all services and collect every env_file declaration
    for (const serviceName of Object.keys(parsed.services)) {
      const service = parsed.services[serviceName];
      if (!service?.env_file) continue;

      if (typeof service.env_file === 'string') {
        const resolvedPath = path.isAbsolute(service.env_file)
          ? service.env_file
          : path.resolve(stackDir, service.env_file);
        envFiles.add(resolvedPath);
      } else if (Array.isArray(service.env_file)) {
        for (const entry of service.env_file) {
          const entryPath = typeof entry === 'string' ? entry : (entry?.path || '');
          if (entryPath) {
            const resolvedPath = path.isAbsolute(entryPath)
              ? entryPath
              : path.resolve(stackDir, entryPath);
            envFiles.add(resolvedPath);
          }
        }
      }
    }

    if (envFiles.size === 0) {
      return [defaultEnvPath];
    }

    return Array.from(envFiles);
  } catch (error) {
    console.warn(`Could not parse compose.yaml for env_file resolution in stack "${stackName}":`, error);
  }

  return [defaultEnvPath];
}

app.get('/api/stacks/:stackName/envs', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const envPaths = await resolveAllEnvFilePaths(stackName);
    res.json({ envFiles: envPaths });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve env files' });
  }
});

app.get('/api/stacks/:stackName/env', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const requestedFile = req.query.file as string | undefined;
    const envPaths = await resolveAllEnvFilePaths(stackName);

    let envPath = envPaths[0]; // Fallback to the first

    if (requestedFile) {
      // Validate that the requested file exists in the allowed resolved list
      if (envPaths.includes(requestedFile)) {
        envPath = requestedFile;
      } else {
        return res.status(400).json({ error: 'Requested env file not allowed' });
      }
    }

    try {
      await fsPromises.access(envPath);
    } catch {
      return res.status(404).json({ error: 'Env file not found' });
    }

    const content = await fsPromises.readFile(envPath, 'utf-8');
    res.send(content);
  } catch (error) {
    console.error('Failed to read env file:', error);
    res.status(500).json({ error: 'Failed to read env file' });
  }
});

app.put('/api/stacks/:stackName/env', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    if (stackName.includes('..') || stackName.includes('/') || stackName.includes('\\')) {
      return res.status(400).json({ error: 'Invalid stack name' });
    }
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }

    const requestedFile = req.query.file as string | undefined;
    const envPaths = await resolveAllEnvFilePaths(stackName);

    let envPath = envPaths[0]; // Fallback

    if (requestedFile) {
      if (envPaths.includes(requestedFile)) {
        envPath = requestedFile;
      } else {
        return res.status(400).json({ error: 'Requested env file not allowed' });
      }
    }

    await fsPromises.writeFile(envPath, content, 'utf-8');
    res.json({ message: 'Env file saved successfully' });
  } catch (error) {
    console.error('Failed to save env file:', error);
    res.status(500).json({ error: 'Failed to save env file' });
  }
});

app.post('/api/stacks', async (req: Request, res: Response) => {
  try {
    const { stackName } = req.body;
    if (!stackName || typeof stackName !== 'string') {
      return res.status(400).json({ error: 'Stack name is required and must be a string' });
    }
    if (!/^[a-zA-Z0-9-]+$/.test(stackName)) {
      return res.status(400).json({ error: 'Stack name can only contain alphanumeric characters and hyphens' });
    }
    await fileSystemService.createStack(stackName);
    res.json({ message: 'Stack created successfully', name: stackName });
  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      return res.status(409).json({ error: 'Stack already exists' });
    }
    console.error('Failed to create stack:', error);
    res.status(500).json({ error: 'Failed to create stack' });
  }
});

app.delete('/api/stacks/:stackName', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;

    // Tear down the stack first to avoid ghost containers
    try {
      console.log(`Tearing down stack: ${stackName}`);
      // Send the down command synchronously before deleting the files
      await composeService.runCommand(stackName, 'down', terminalWs || undefined);
    } catch (downError) {
      console.warn(`Failed to tear down stack ${stackName}, proceeding with file deletion.`, downError);
    }

    await fileSystemService.deleteStack(stackName);
    res.json({ message: 'Stack deleted successfully' });
  } catch (error) {
    console.error('Failed to delete stack:', error);
    res.status(500).json({ error: 'Failed to delete stack' });
  }
});

app.get('/api/stacks/:stackName/containers', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);
    res.json(containers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch containers' });
  }
});

app.post('/api/containers/:id/start', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance();
    await dockerController.startContainer(id);
    res.json({ message: 'Container started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start container' });
  }
});

app.post('/api/containers/:id/stop', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance();
    await dockerController.stopContainer(id);
    res.json({ message: 'Container stopped' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop container' });
  }
});

app.post('/api/containers/:id/restart', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dockerController = DockerController.getInstance();
    await dockerController.restartContainer(id);
    res.json({ message: 'Container restarted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart container' });
  }
});

// End of legacy container routes
app.post('/api/stacks/:stackName/deploy', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    await composeService.deployStack(stackName, terminalWs || undefined);
    res.json({ message: 'Deployed successfully' });
  } catch (error: any) {
    console.error('Failed to deploy stack:', error);
    res.status(500).json({ error: error.message || 'Failed to deploy stack' });
  }
});

app.post('/api/stacks/:stackName/down', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    await composeService.runCommand(stackName, 'down', terminalWs || undefined);
    res.json({ status: 'Command started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start command' });
  }
});

app.post('/api/stacks/:stackName/restart', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.restartContainer(c.Id)));
    res.json({ success: true, message: 'Restart completed via Engine API.' });
  } catch (error: any) {
    console.error('Failed to restart containers:', error);
    res.status(500).json({ error: error.message || 'Failed to restart containers' });
  }
});

app.post('/api/stacks/:stackName/stop', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.stopContainer(c.Id)));
    res.json({ success: true, message: 'Stop completed via Engine API.' });
  } catch (error: any) {
    console.error('Failed to stop containers:', error);
    res.status(500).json({ error: error.message || 'Failed to stop containers' });
  }
});

app.post('/api/stacks/:stackName/start', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);

    if (!containers || containers.length === 0) {
      return res.status(404).json({ error: 'No containers found for this stack.' });
    }

    await Promise.all(containers.map(c => dockerController.startContainer(c.Id)));
    res.json({ success: true, message: 'Start completed via Engine API.' });
  } catch (error: any) {
    console.error('Failed to start containers:', error);
    res.status(500).json({ error: error.message || 'Failed to start containers' });
  }
});

// Update stack: pull images and recreate containers
app.post('/api/stacks/:stackName/update', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    // Await update completion
    await composeService.updateStack(stackName, terminalWs || undefined);
    res.json({ status: 'Update completed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

// Docker Run to Compose converter endpoint
app.post('/api/convert', async (req: Request, res: Response) => {
  try {
    const { dockerRun } = req.body;
    if (!dockerRun || typeof dockerRun !== 'string') {
      return res.status(400).json({ error: 'dockerRun command is required' });
    }
    const yaml = composerize(dockerRun);
    res.json({ yaml });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Failed to convert docker run command' });
  }
});

// Get all containers stats for dashboard
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getRunningContainers();
    const allContainers = await dockerController.getAllContainers();

    const active = containers.length;
    const exited = allContainers.filter((c: { State: string }) => c.State === 'exited').length;
    const total = allContainers.length;

    res.json({ active, exited, total, inactive: total - active - exited });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get host system stats
app.get('/api/system/stats', async (req: Request, res: Response) => {
  try {
    const [currentLoad, mem, fsSize] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize()
    ]);

    let rxSec = Math.max(0, globalDockerNetwork.rxSec);
    let txSec = Math.max(0, globalDockerNetwork.txSec);
    let rxBytes = 0;
    let txBytes = 0;

    // Find the main mount (usually the largest or root mount)
    const mainDisk = fsSize.find(fs => fs.mount === '/' || fs.mount === 'C:') || fsSize[0];

    res.json({
      cpu: {
        usage: currentLoad.currentLoad.toFixed(1),
        cores: currentLoad.cpus.length,
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usagePercent: ((mem.used / mem.total) * 100).toFixed(1),
      },
      disk: mainDisk ? {
        fs: mainDisk.fs,
        mount: mainDisk.mount,
        total: mainDisk.size,
        used: mainDisk.used,
        free: mainDisk.available,
        usagePercent: mainDisk.use ? mainDisk.use.toFixed(1) : '0',
      } : null,
      network: {
        rxBytes,
        txBytes,
        rxSec,
        txSec
      }
    });
  } catch (error) {
    console.error('Failed to fetch system stats:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
});

// --- Notification & Alerting Routes ---

app.get('/api/agents', async (req: Request, res: Response) => {
  try {
    const agents = DatabaseService.getInstance().getAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

app.post('/api/agents', async (req: Request, res: Response) => {
  try {
    const agent = req.body;
    DatabaseService.getInstance().upsertAgent(agent);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

app.get('/api/settings', async (req: Request, res: Response) => {
  try {
    const settings = DatabaseService.getInstance().getGlobalSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    DatabaseService.getInstance().updateGlobalSetting(key, value);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

app.get('/api/alerts', async (req: Request, res: Response) => {
  try {
    let stackName = req.query.stackName as string | undefined;
    if (Array.isArray(stackName)) stackName = stackName[0] as string;

    const alerts = DatabaseService.getInstance().getStackAlerts(stackName);
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

app.post('/api/alerts', async (req: Request, res: Response) => {
  try {
    const alert = req.body;
    DatabaseService.getInstance().addStackAlert(alert);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add alert' });
  }
});

app.delete('/api/alerts/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    DatabaseService.getInstance().deleteStackAlert(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

app.get('/api/notifications', async (req: Request, res: Response) => {
  try {
    const history = DatabaseService.getInstance().getNotificationHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/read', async (req: Request, res: Response) => {
  try {
    DatabaseService.getInstance().markAllNotificationsRead();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

app.delete('/api/notifications/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    DatabaseService.getInstance().deleteNotification(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.delete('/api/notifications', async (req: Request, res: Response) => {
  try {
    DatabaseService.getInstance().deleteAllNotifications();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

app.post('/api/notifications/test', async (req: Request, res: Response) => {
  try {
    const { type, url } = req.body;
    await NotificationService.getInstance().testDispatch(type, url);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Test failed', details: error.message });
  }
});

// --- System Maintenance Routes (The System Janitor) ---

app.get('/api/system/orphans', async (req: Request, res: Response) => {
  try {
    const knownStacks = await fileSystemService.getStacks();
    const dockerController = DockerController.getInstance();
    const orphans = await dockerController.getOrphanContainers(knownStacks);
    res.json(orphans);
  } catch (error) {
    console.error('Failed to fetch orphan containers:', error);
    res.status(500).json({ error: 'Failed to fetch orphan containers' });
  }
});

app.post('/api/system/prune/orphans', async (req: Request, res: Response) => {
  try {
    const { containerIds } = req.body;
    if (!Array.isArray(containerIds)) {
      return res.status(400).json({ error: 'containerIds must be an array' });
    }
    const dockerController = DockerController.getInstance();
    const results = await dockerController.removeContainers(containerIds);
    res.json({ results });
  } catch (error) {
    console.error('Failed to prune orphan containers:', error);
    res.status(500).json({ error: 'Failed to prune orphan containers' });
  }
});

app.post('/api/system/prune/system', async (req: Request, res: Response) => {
  try {
    const { target } = req.body; // 'containers', 'images', 'networks', 'volumes'
    if (!['containers', 'images', 'networks', 'volumes'].includes(target)) {
      return res.status(400).json({ error: 'Invalid prune target' });
    }

    const dockerController = DockerController.getInstance();
    const result = await dockerController.pruneSystem(target);

    res.json({ message: 'Prune completed', ...result });
  } catch (error: any) {
    console.error('System prune error:', error);
    res.status(500).json({ error: 'System prune failed', details: error.message });
  }
});

app.get('/api/system/docker-df', async (req: Request, res: Response) => {
  try {
    const dockerController = DockerController.getInstance();
    const df = await dockerController.getDiskUsage();
    res.json(df);
  } catch (error) {
    console.error('Failed to fetch docker disk usage:', error);
    res.status(500).json({ error: 'Failed to fetch docker disk usage' });
  }
});

// Serve static files in production (for Docker deployment)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));

  // Handle SPA routing - serve index.html for non-API routes
  // Using app.use middleware instead of app.get('*') for path-to-regexp compatibility
  app.use((req: Request, res: Response) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile('index.html', { root: 'public' });
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
} else {
  // In development, still need to catch 404s for API to prevent hangs
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });
}

// Start server with migration
async function startServer() {
  try {
    // Run migration before starting server
    console.log('Running stack migration check...');
    await fileSystemService.migrateFlatToDirectory();
    console.log('Migration check completed');
  } catch (error) {
    console.error('Migration failed:', error);
    // Continue starting server even if migration fails
  }

  // Start Background Watchdog
  MonitorService.getInstance().start();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
