import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import DockerController from './services/DockerController';
import { FileSystemService } from './services/FileSystemService';
import { ComposeService } from './services/ComposeService';
import { ConfigService } from './services/ConfigService';
// @ts-ignore - composerize lacks proper type definitions
import composerize from 'composerize';
import si from 'systeminformation';
import http from 'http';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();
const PORT = 3000;

// ConfigService for persistent auth storage
const configService = new ConfigService();

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
    const jwtSecret = await configService.getJwtSecret();
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
    const needsSetup = await configService.needsSetup();
    res.json({ needsSetup });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.json({ needsSetup: true });
  }
});

// Initial setup endpoint
app.post('/api/auth/setup', async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if setup is still needed
    const needsSetup = await configService.needsSetup();
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
    await configService.saveConfig(username, password);

    // Issue JWT and log user in
    const jwtSecret = await configService.getJwtSecret();
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
    const isValid = await configService.validateCredentials(username, password);

    if (isValid) {
      const jwtSecret = await configService.getJwtSecret();
      const token = jwt.sign({ username }, jwtSecret, { expiresIn: '24h' });
      res.cookie(COOKIE_NAME, token, getCookieOptions(req));
      res.json({ success: true, message: 'Login successful' });
      return;
    }

    res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
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
    const jwtSecret = await configService.getJwtSecret();
    jwt.verify(token, jwtSecret);

    // Check if this is a stack logs WebSocket request
    const url = req.url || '';
    const logsMatch = url.match(/^\/api\/stacks\/([^/]+)\/logs$/);

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

app.get('/api/stacks/:stackName/env', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const exists = await fileSystemService.envExists(stackName);
    if (!exists) {
      return res.status(404).json({ error: 'Env file not found' });
    }
    const content = await fileSystemService.getEnvContent(stackName);
    res.send(content);
  } catch (error) {
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
    await fileSystemService.saveEnvContent(stackName, content);
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
app.post('/api/stacks/:stackName/up', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    composeService.runCommand(stackName, 'up', terminalWs || undefined);
    res.json({ status: 'Command started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start command' });
  }
});

app.post('/api/stacks/:stackName/down', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    composeService.runCommand(stackName, 'down', terminalWs || undefined);
    res.json({ status: 'Command started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start command' });
  }
});

// Direct container restart - bypasses docker compose for legacy container support
app.post('/api/stacks/:stackName/restart', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);
    if (containers && containers.length > 0) {
      for (const c of containers) {
        await dockerController.restartContainer(c.Id);
      }
    }
    res.json({ status: 'Containers restarted' });
  } catch (error) {
    console.error('Failed to restart containers:', error);
    res.status(500).json({ error: 'Failed to restart containers' });
  }
});

// Direct container stop - bypasses docker compose for legacy container support
// Only stops containers that are currently running to avoid 304 errors
app.post('/api/stacks/:stackName/stop', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);
    if (containers && containers.length > 0) {
      for (const c of containers) {
        if (c.State === 'running') {
          await dockerController.stopContainer(c.Id);
        }
      }
    }
    res.json({ status: 'Containers stopped' });
  } catch (error) {
    console.error('Failed to stop containers:', error);
    res.status(500).json({ error: 'Failed to stop containers' });
  }
});

// Direct container start - bypasses docker compose for legacy container support
// Only starts containers that are not currently running
app.post('/api/stacks/:stackName/start', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    const dockerController = DockerController.getInstance();
    const containers = await dockerController.getContainersByStack(stackName);
    if (containers && containers.length > 0) {
      for (const c of containers) {
        if (c.State !== 'running') {
          await dockerController.startContainer(c.Id);
        }
      }
    }
    res.json({ status: 'Containers started' });
  } catch (error) {
    console.error('Failed to start containers:', error);
    res.status(500).json({ error: 'Failed to start containers' });
  }
});

// Update stack: pull images and recreate containers
app.post('/api/stacks/:stackName/update', async (req: Request, res: Response) => {
  try {
    const stackName = req.params.stackName as string;
    // Run update asynchronously, don't wait for completion
    composeService.updateStack(stackName, terminalWs || undefined).catch(error => {
      console.error('Update stack error:', error);
    });
    res.json({ status: 'Update started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start update' });
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
      si.fsSize(),
    ]);

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
    });
  } catch (error) {
    console.error('Failed to fetch system stats:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
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
    const { target } = req.body; // 'containers', 'images', 'networks'
    let command = '';

    if (target === 'containers') {
      command = 'docker container prune -f';
    } else if (target === 'images') {
      command = 'docker image prune -a -f';
    } else if (target === 'networks') {
      command = 'docker network prune -f';
    } else {
      return res.status(400).json({ error: 'Invalid prune target' });
    }

    const { stdout, stderr } = await execAsync(command, {
      env: {
        ...process.env,
        PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      }
    });

    res.json({ message: 'Prune completed', stdout, stderr });
  } catch (error: any) {
    console.error('System prune error:', error);
    res.status(500).json({ error: 'System prune failed', details: error.message });
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

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
