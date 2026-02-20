import { spawn } from 'child_process';
import path from 'path';
import WebSocket from 'ws';

export class ComposeService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.COMPOSE_DIR || path.join(process.cwd(), '..', 'mock_data', 'docker', 'compose');
  }

  runCommand(filename: string, action: 'up' | 'down', ws?: WebSocket) {
    const filePath = path.join(this.baseDir, filename);
    const args = action === 'up' ? ['compose', '-f', filePath, 'up', '-d'] : ['compose', '-f', filePath, 'down'];

    const child = spawn('docker', args, { shell: true });

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

  // Update command: pull images first, then recreate containers
  async updateStack(filename: string, ws?: WebSocket): Promise<void> {
    const filePath = path.join(this.baseDir, filename);

    const sendOutput = (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    // Step 1: Pull images
    sendOutput('=== Pulling latest images ===\n');
    await new Promise<void>((resolve, reject) => {
      const pullProcess = spawn('docker', ['compose', '-f', filePath, 'pull'], { shell: true });

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
      const upProcess = spawn('docker', ['compose', '-f', filePath, 'up', '-d'], { shell: true });

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
