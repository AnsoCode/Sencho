import { apiFetch } from './api';
import { parseApiError } from './stackFilesApi';
import type { FileEntry } from './stackFilesApi';

export interface VolumeFileResult {
  content: string;
  encoding: 'utf-8' | 'base64';
  binary: boolean;
  truncated: boolean;
  size: number;
  mime: string;
}

export interface VolumeStat extends FileEntry {
  symlinkTarget?: string;
}

function volumeUrl(volumeName: string, suffix: string): string {
  return `/volumes/${encodeURIComponent(volumeName)}${suffix}`;
}

export async function listVolumeDirectory(
  volumeName: string,
  relPath: string
): Promise<FileEntry[]> {
  const res = await apiFetch(volumeUrl(volumeName, `/list?path=${encodeURIComponent(relPath)}`));
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<FileEntry[]>;
}

export async function readVolumeFile(
  volumeName: string,
  relPath: string
): Promise<VolumeFileResult> {
  const res = await apiFetch(volumeUrl(volumeName, `/read?path=${encodeURIComponent(relPath)}`));
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<VolumeFileResult>;
}

export async function statVolumePath(
  volumeName: string,
  relPath: string
): Promise<VolumeStat> {
  const res = await apiFetch(volumeUrl(volumeName, `/stat?path=${encodeURIComponent(relPath)}`));
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<VolumeStat>;
}
