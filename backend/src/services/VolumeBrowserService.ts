import { Writable } from 'stream';
import path from 'path';
import DockerController from './DockerController';

const HELPER_IMAGE = 'alpine:3.20';
const VOLUME_MOUNT = '/v';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const EXEC_TIMEOUT_MS = 30_000;

// Portable shell scripts that work with BusyBox sh + stat (Alpine) and GNU
// coreutils alike. The user-supplied relative path arrives as $1; we cd into
// it before iterating, so user input never lands as an argv element to a
// command that might interpret it as a flag.
const LIST_SCRIPT = `set -e
cd -- "$1" 2>/dev/null || { echo "cd: $1: No such file or directory" >&2; exit 1; }
for entry in * .[!.]* ..?*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  if [ -L "$entry" ]; then t=l; link=$(readlink -- "$entry" 2>/dev/null || echo "")
  elif [ -d "$entry" ]; then t=d; link=""
  elif [ -f "$entry" ]; then t=f; link=""
  else t=o; link=""
  fi
  size=$(stat -c '%s' -- "$entry" 2>/dev/null || echo 0)
  mtime=$(stat -c '%Y' -- "$entry" 2>/dev/null || echo 0)
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$t" "$size" "$mtime" "$entry" "$link"
done`;

const STAT_SCRIPT = `set -e
target="$1"
[ -e "$target" ] || [ -L "$target" ] || { echo "cannot access $target" >&2; exit 1; }
if [ -L "$target" ]; then t=l; link=$(readlink -- "$target" 2>/dev/null || echo "")
elif [ -d "$target" ]; then t=d; link=""
elif [ -f "$target" ]; then t=f; link=""
else t=o; link=""
fi
size=$(stat -c '%s' -- "$target" 2>/dev/null || echo 0)
mtime=$(stat -c '%Y' -- "$target" 2>/dev/null || echo 0)
name=$(basename -- "$target")
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$t" "$size" "$mtime" "$name" "$link"`;

export interface VolumeEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  mtime: number;
  isProtected: boolean;
  symlinkTarget?: string;
}

export interface VolumeFileResult {
  content: string;
  encoding: 'utf-8' | 'base64';
  binary: boolean;
  truncated: boolean;
  size: number;
  mime: string;
}

export type VolumeStat = VolumeEntry;

export class PathTraversalError extends Error {
  status = 400;
  constructor() { super('Path escapes volume root'); this.name = 'PathTraversalError'; }
}

export class VolumeNotFoundError extends Error {
  status = 404;
  constructor(name: string) { super(`Volume '${name}' not found`); this.name = 'VolumeNotFoundError'; }
}

export class HelperImageError extends Error {
  status = 503;
  constructor(reason: string) { super(`Volume browser helper unavailable: ${reason}`); this.name = 'HelperImageError'; }
}

export class ExecError extends Error {
  status: number;
  constructor(message: string, status = 500) { super(message); this.status = status; this.name = 'ExecError'; }
}

const helperImageReady = new Map<number, boolean>();

export class VolumeBrowserService {
  private nodeId: number;

  private constructor(nodeId: number) { this.nodeId = nodeId; }

  static getInstance(nodeId?: number): VolumeBrowserService {
    return new VolumeBrowserService(nodeId ?? 1);
  }

  async listDir(volumeName: string, relPath: string): Promise<VolumeEntry[]> {
    const safe = sanitizeRelPath(relPath);
    await this.assertVolumeExists(volumeName);
    await this.ensureHelperImage();

    // Portable across BusyBox (Alpine) and GNU coreutils. Lists each
    // direct child with a tab-separated row: type<TAB>size<TAB>mtime<TAB>
    // name<TAB>symlinkTarget. We chdir to /v/<safe> first so user input is
    // never an argv element passed to find/stat.
    const script = LIST_SCRIPT;
    const { stdout, stderr, exitCode } = await this.runHelper(volumeName, [
      'sh', '-c', script, 'sh', `./${safe || ''}`,
    ]);

    if (exitCode !== 0) {
      const msg = stderr.toString('utf-8').trim();
      if (/No such file or directory|cannot access|cd:.*?:/i.test(msg)) throw new ExecError('Path not found', 404);
      if (/Permission denied/i.test(msg)) throw new ExecError('Permission denied', 403);
      throw new ExecError(`Listing failed: ${msg.substring(0, 200) || 'unknown error'}`);
    }

    const entries: VolumeEntry[] = [];
    const lines = stdout.toString('utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 4) continue;
      const [shType, sizeStr, mtimeStr, name, link = ''] = parts;
      if (!name) continue;
      const type: VolumeEntry['type'] =
        shType === 'd' ? 'directory'
        : shType === 'f' ? 'file'
        : shType === 'l' ? 'symlink'
        : 'other';
      entries.push({
        name,
        type,
        size: Number(sizeStr) || 0,
        mtime: Math.floor(Number(mtimeStr) || 0),
        isProtected: false,
        ...(type === 'symlink' && link ? { symlinkTarget: link } : {}),
      });
    }
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async stat(volumeName: string, relPath: string): Promise<VolumeStat> {
    const safe = sanitizeRelPath(relPath);
    await this.assertVolumeExists(volumeName);
    await this.ensureHelperImage();

    const { stdout, stderr, exitCode } = await this.runHelper(volumeName, [
      'sh', '-c', STAT_SCRIPT, 'sh', `./${safe || ''}`,
    ]);
    if (exitCode !== 0) {
      const msg = stderr.toString('utf-8').trim();
      if (/No such file or directory|cannot access/i.test(msg)) throw new ExecError('Path not found', 404);
      throw new ExecError(`Stat failed: ${msg.substring(0, 200) || 'unknown error'}`);
    }
    const line = stdout.toString('utf-8').split('\n').filter(Boolean)[0] ?? '';
    const parts = line.split('\t');
    const [shType, sizeStr, mtimeStr, name, link = ''] = parts;
    const type: VolumeEntry['type'] =
      shType === 'd' ? 'directory'
      : shType === 'f' ? 'file'
      : shType === 'l' ? 'symlink'
      : 'other';
    return {
      name: name || path.posix.basename(safe || '/'),
      type,
      size: Number(sizeStr) || 0,
      mtime: Math.floor(Number(mtimeStr) || 0),
      isProtected: false,
      ...(type === 'symlink' && link ? { symlinkTarget: link } : {}),
    };
  }

  async readFile(volumeName: string, relPath: string, opts: { maxBytes?: number } = {}): Promise<VolumeFileResult> {
    const safe = sanitizeRelPath(relPath);
    if (!safe) throw new ExecError('Cannot read volume root', 400);
    const maxBytes = Math.max(1, Math.min(opts.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES));
    await this.assertVolumeExists(volumeName);
    await this.ensureHelperImage();

    const meta = await this.stat(volumeName, safe);
    if (meta.type === 'symlink') throw new ExecError('Refusing to follow symlink', 400);
    if (meta.type !== 'file') throw new ExecError('Not a regular file', 400);

    // Read up to maxBytes+1 to detect truncation precisely. The path is
    // passed as $1 (an argv element, never concatenated) and read with
    // head -c -- "$1" so a leading-dash filename is never parsed as a flag.
    const { stdout, stderr, exitCode } = await this.runHelper(volumeName, [
      'sh', '-c',
      `head -c ${maxBytes + 1} -- "$1"`,
      'sh', `./${safe}`,
    ]);
    if (exitCode !== 0) {
      const msg = stderr.toString('utf-8').trim();
      if (/Permission denied/i.test(msg)) throw new ExecError('Permission denied', 403);
      throw new ExecError(`Read failed: ${msg.substring(0, 200) || 'unknown error'}`);
    }

    const truncated = stdout.length > maxBytes;
    const buf = truncated ? stdout.subarray(0, maxBytes) : stdout;
    const binary = isBinaryBuffer(buf);
    const mime = binary ? 'application/octet-stream' : 'text/plain';

    return {
      content: binary ? buf.toString('base64') : buf.toString('utf-8'),
      encoding: binary ? 'base64' : 'utf-8',
      binary,
      truncated,
      size: meta.size,
      mime,
    };
  }

  // --- internals -----------------------------------------------------------

  private async assertVolumeExists(volumeName: string): Promise<void> {
    if (!isValidVolumeName(volumeName)) throw new ExecError('Invalid volume name', 400);
    const docker = DockerController.getInstance(this.nodeId).getDocker();
    try {
      await docker.getVolume(volumeName).inspect();
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 404 || /no such volume/i.test(e.message ?? '')) {
        throw new VolumeNotFoundError(volumeName);
      }
      throw new ExecError(`Volume inspect failed: ${e.message ?? 'unknown'}`);
    }
  }

  private async ensureHelperImage(): Promise<void> {
    if (helperImageReady.get(this.nodeId)) return;
    const docker = DockerController.getInstance(this.nodeId).getDocker();
    try {
      await docker.getImage(HELPER_IMAGE).inspect();
      helperImageReady.set(this.nodeId, true);
      return;
    } catch { /* not present, pull it */ }

    try {
      await new Promise<void>((resolve, reject) => {
        docker.pull(HELPER_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream | null) => {
          if (err || !stream) { reject(err ?? new Error('pull stream missing')); return; }
          docker.modem.followProgress(stream, (finishErr: Error | null) => {
            if (finishErr) reject(finishErr); else resolve();
          });
        });
      });
      helperImageReady.set(this.nodeId, true);
    } catch (err) {
      throw new HelperImageError((err as Error).message ?? 'pull failed');
    }
  }

  private async runHelper(volumeName: string, cmd: string[]): Promise<{ stdout: Buffer; stderr: Buffer; exitCode: number }> {
    const docker = DockerController.getInstance(this.nodeId).getDocker();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutStream = new Writable({ write(chunk, _enc, cb) { stdoutChunks.push(chunk); cb(); } });
    const stderrStream = new Writable({ write(chunk, _enc, cb) { stderrChunks.push(chunk); cb(); } });

    // Manual lifecycle (create -> attach -> start -> wait -> remove). Using
    // dockerode's docker.run() with AutoRemove races: Docker can delete the
    // container before run()'s internal wait() callback fires, surfacing as
    // a 404 "no such container" from docker-modem.
    const container = await docker.createContainer({
      Image: HELPER_IMAGE,
      Cmd: cmd,
      Tty: false,
      User: '65534:65534',
      WorkingDir: VOLUME_MOUNT,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        ReadonlyRootfs: true,
        NetworkMode: 'none',
        CapDrop: ['ALL'],
        Privileged: false,
        SecurityOpt: ['no-new-privileges:true'],
        PidsLimit: 64,
        Memory: 128 * 1024 * 1024,
        Mounts: [{
          Type: 'volume',
          Source: volumeName,
          Target: VOLUME_MOUNT,
          ReadOnly: true,
        }],
      },
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ExecError('Helper exec timed out', 504)), EXEC_TIMEOUT_MS);
    });

    const runPromise = (async () => {
      const stream = await container.attach({ stream: true, stdout: true, stderr: true });
      const streamEnded = new Promise<void>((resolve) => {
        stream.once('end', () => resolve());
        stream.once('close', () => resolve());
      });
      docker.modem.demuxStream(stream, stdoutStream, stderrStream);
      await container.start();
      const exitInfo = await container.wait();
      // Wait for the attach stream to finish flushing demuxed output.
      await streamEnded;
      return {
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode: typeof exitInfo?.StatusCode === 'number' ? exitInfo.StatusCode : 0,
      };
    })();

    try {
      return await Promise.race([runPromise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      // Always tear down the helper, regardless of how runPromise resolved.
      try { await container.remove({ force: true }); } catch { /* container may have been killed by timeout already */ }
    }
  }
}

// --- helpers -----------------------------------------------------------------

const VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/;
export function isValidVolumeName(name: string): boolean {
  return typeof name === 'string' && VOLUME_NAME_RE.test(name);
}

export function sanitizeRelPath(relPath: string): string {
  if (typeof relPath !== 'string') throw new PathTraversalError();
  if (relPath.length > 1024) throw new PathTraversalError();
  if (relPath.includes('\0')) throw new PathTraversalError();
  // Normalize away leading slashes; reject absolute and parent-escape.
  let p = relPath.replace(/^\/+/, '');
  if (p === '' || p === '.') return '';
  if (p.split('/').some((seg) => seg === '..')) throw new PathTraversalError();
  // posix-resolve and re-check that it stays under the mount root.
  const resolved = path.posix.resolve(VOLUME_MOUNT, p);
  if (resolved !== VOLUME_MOUNT && !resolved.startsWith(`${VOLUME_MOUNT}/`)) {
    throw new PathTraversalError();
  }
  // Return the trailing portion (without the /v prefix) so callers can re-join.
  return resolved === VOLUME_MOUNT ? '' : resolved.slice(VOLUME_MOUNT.length + 1);
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
