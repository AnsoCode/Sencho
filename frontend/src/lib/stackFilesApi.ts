import { apiFetch } from './api';

export interface FileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mtime: number;
  isProtected: boolean;
}

export interface FileContentResult {
  content?: string;
  binary: boolean;
  oversized: boolean;
  size: number;
  mime: string;
}

export async function parseApiError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return (data as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function stackFilesUrl(stackName: string, suffix: string): string {
  return `/stacks/${encodeURIComponent(stackName)}/files${suffix}`;
}

export async function listStackDirectory(
  stackName: string,
  relPath: string
): Promise<FileEntry[]> {
  const res = await apiFetch(stackFilesUrl(stackName, `?path=${encodeURIComponent(relPath)}`));
  return res.json() as Promise<FileEntry[]>;
}

export async function readStackFile(
  stackName: string,
  relPath: string
): Promise<FileContentResult> {
  const res = await apiFetch(stackFilesUrl(stackName, `/content?path=${encodeURIComponent(relPath)}`));
  return res.json() as Promise<FileContentResult>;
}

export async function downloadStackFile(
  stackName: string,
  relPath: string
): Promise<Response> {
  return apiFetch(stackFilesUrl(stackName, `/download?path=${encodeURIComponent(relPath)}`));
}

export async function uploadStackFile(
  stackName: string,
  targetDir: string,
  file: File
): Promise<void> {
  const fd = new FormData();
  fd.append('file', file, file.name);

  const activeNodeId = localStorage.getItem('sencho-active-node');
  const headers: Record<string, string> = {};
  if (activeNodeId) {
    headers['x-node-id'] = activeNodeId;
  }

  // Use fetch directly: apiFetch always sets Content-Type: application/json,
  // which breaks multipart boundary negotiation. The 401 side-effects are
  // replicated manually below.
  const res = await fetch(
    `/api${stackFilesUrl(stackName, `/upload?path=${encodeURIComponent(targetDir)}`)}`,
    { method: 'POST', credentials: 'include', headers, body: fd }
  );

  if (res.status === 401) {
    if (!res.headers.get('x-sencho-proxy')) {
      window.dispatchEvent(new Event('sencho-unauthorized'));
    }
    throw new Error('Unauthorized');
  }
}

export async function writeStackFile(
  stackName: string,
  relPath: string,
  content: string
): Promise<void> {
  await apiFetch(
    stackFilesUrl(stackName, `/content?path=${encodeURIComponent(relPath)}`),
    { method: 'PUT', body: JSON.stringify({ content }) }
  );
}

export async function deleteStackPath(
  stackName: string,
  relPath: string,
  recursive?: boolean
): Promise<void> {
  const qs = recursive
    ? `path=${encodeURIComponent(relPath)}&recursive=1`
    : `path=${encodeURIComponent(relPath)}`;
  await apiFetch(stackFilesUrl(stackName, `?${qs}`), { method: 'DELETE' });
}

export async function mkdirStackPath(
  stackName: string,
  relPath: string
): Promise<void> {
  await apiFetch(
    stackFilesUrl(stackName, `/folder?path=${encodeURIComponent(relPath)}`),
    { method: 'POST', body: JSON.stringify({}) }
  );
}
