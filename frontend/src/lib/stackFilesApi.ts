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
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<FileEntry[]>;
}

export async function readStackFile(
  stackName: string,
  relPath: string
): Promise<FileContentResult> {
  const res = await apiFetch(stackFilesUrl(stackName, `/content?path=${encodeURIComponent(relPath)}`));
  if (!res.ok) throw new Error(await parseApiError(res));
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
  file: File,
  options?: { localOnly?: boolean }
): Promise<void> {
  const fd = new FormData();
  fd.append('file', file, file.name);

  const activeNodeId = options?.localOnly ? null : localStorage.getItem('sencho-active-node');
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

  if (!res.ok) {
    if (res.status === 404) {
      try {
        const clone = res.clone();
        const errData = await clone.json();
        if (errData.error?.includes('not found') && errData.error?.includes('Node')) {
          window.dispatchEvent(new Event('node-not-found'));
        }
      } catch { /* ignore */ }
    }
    throw new Error(await parseApiError(res));
  }
}

export async function writeStackFile(
  stackName: string,
  relPath: string,
  content: string
): Promise<void> {
  const res = await apiFetch(
    stackFilesUrl(stackName, `/content?path=${encodeURIComponent(relPath)}`),
    { method: 'PUT', body: JSON.stringify({ content }) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
}

export async function deleteStackPath(
  stackName: string,
  relPath: string,
  recursive?: boolean
): Promise<void> {
  const qs = recursive
    ? `path=${encodeURIComponent(relPath)}&recursive=1`
    : `path=${encodeURIComponent(relPath)}`;
  const res = await apiFetch(stackFilesUrl(stackName, `?${qs}`), { method: 'DELETE' });
  if (!res.ok) throw new Error(await parseApiError(res));
}

export async function mkdirStackPath(
  stackName: string,
  relPath: string
): Promise<void> {
  const res = await apiFetch(
    stackFilesUrl(stackName, `/folder?path=${encodeURIComponent(relPath)}`),
    { method: 'POST', body: JSON.stringify({}) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
}

export async function renameStackPath(
  stackName: string,
  fromRel: string,
  toRel: string
): Promise<void> {
  const res = await apiFetch(
    stackFilesUrl(stackName, '/rename'),
    { method: 'PATCH', body: JSON.stringify({ from: fromRel, to: toRel }) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
}

export interface EntryPermissions {
  mode: number;
  octal: string;
}

export async function getStackEntryPermissions(
  stackName: string,
  relPath: string
): Promise<EntryPermissions> {
  const res = await apiFetch(stackFilesUrl(stackName, `/permissions?path=${encodeURIComponent(relPath)}`));
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<EntryPermissions>;
}

export async function setStackEntryPermissions(
  stackName: string,
  relPath: string,
  mode: number
): Promise<void> {
  const res = await apiFetch(
    stackFilesUrl(stackName, `/permissions?path=${encodeURIComponent(relPath)}`),
    { method: 'PUT', body: JSON.stringify({ mode }) }
  );
  if (!res.ok) throw new Error(await parseApiError(res));
}

