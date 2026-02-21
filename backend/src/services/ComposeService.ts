import { spawn } from 'child_process';
import path from 'path';
import WebSocket from 'ws';

export class ComposeService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.COMPOSE_DIR || path.join(process.cwd(), '..', 'mock_data', 'docker', 'compose');
  }

  /**
   * Run docker compose up or down command
   * CRITICAL: cwd is set to the stack directory so relative paths in compose files
   * resolve correctly inside the isolated stack folder
   */
  runCommand(stackName: string, action: 'up' | 'down', ws?: WebSocket) {
    const stackDir = path.join(this.baseDir, stackName);
    
    // Run docker compose from within the stack directory
    // This ensures relative paths (e.g., ./data:/config) resolve correctly
    const args = action === 'up' 
      ? ['compose', 'up', '-d'] 
      : ['compose', 'down'];

    const child = spawn('docker', args, { 
      cwd: stackDir,  // CRITICAL: Set working directory to stack folder
      shell: true 
    });

    if (ws) {
      child.stdout.on('data', (data: Buffer) => {
        ws.send(data.toString());
      });

      child.stderr.on('data', (data: Buffer) => {
        ws.send(data.toString());
      });

      child.on('close', (code: number | null) => {
        ws.send(`Command exited with code ${code}\n`);
      });

      child.on('error', (error: Error) => {
        ws.send(`Error: ${error.message}\n`);
      });
    }
  }

  /**
   * Update stack: pull images first, then recreate containers
   * CRITICAL: cwd is set to the stack directory so relative paths resolve correctly
   */
  async updateStack(stackName: string, ws?: WebSocket): Promise<void> {
    const stackDir = path.join(this.baseDir, stackName);

    const sendOutput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    // Step 1: Pull images
    sendOutput('=== Pulling latest images ===\n');
    await new Promise<void>((resolve, reject) => {
      const pullProcess = spawn('docker', ['compose', 'pull'], { 
        cwd: stackDir,
        shell: true 
      });

      pullProcess.stdout.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      pullProcess.stderr.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      pullProcess.on('close', (code: number | null) => {
        if (code === 0) {
          sendOutput('=== Images pulled successfully ===\n');
          resolve();
        } else {
          sendOutput(`=== Pull failed with code ${code} ===\n`);
          reject(new Error(`Pull failed with code ${code}`));
        }
      });

      pullProcess.on('error', (error: Error) => {
        sendOutput(`Pull error: ${error.message}\n`);
        reject(error);
      });
    });

    // Step 2: Recreate containers with new images
    sendOutput('=== Recreating containers ===\n');
    await new Promise<void>((resolve, reject) => {
      const upProcess = spawn('docker', ['compose', 'up', '-d'], { 
        cwd: stackDir,
        shell: true 
      });

      upProcess.stdout.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      upProcess.stderr.on('data', (data: Buffer) => {
        sendOutput(data.toString());
      });

      upProcess.on('close', (code: number | null) => {
        if (code === 0) {
          sendOutput('=== Stack updated successfully ===\n');
          resolve();
        } else {
          sendOutput(`=== Update failed with code ${code} ===\n`);
          reject(new Error(`Up failed with code ${code}`));
        }
      });

      upProcess.on('error', (error: Error) => {
        sendOutput(`Update error: ${error.message}\n`);
        reject(error);
      });
    });
  }
}
