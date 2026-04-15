/**
 * HTTP helpers for the git-source routes.
 *
 * Isolated here (instead of inlined in index.ts) so the status mapping is
 * unit-testable without booting the full Express app.
 *
 * Design rule: never return 401 for a git-source error. On the frontend,
 * `apiFetch` treats a 401 as "your Sencho session expired" and fires a
 * global logout event. Upstream git-host auth failures (bad PAT, expired
 * token, repo-level permission denied) are not that, and must not kick the
 * user out of the app. Map those to 400 with `code: 'AUTH_FAILED'` so the
 * UI can distinguish them by the body field, not the status.
 */
import type { Response } from 'express';
import type { GitSourceErrorCode } from '../services/GitSourceService';
import { GitSourceError } from '../services/GitSourceService';

export function gitSourceStatus(code: GitSourceErrorCode): number {
  switch (code) {
    case 'AUTH_FAILED': return 400;
    case 'REPO_NOT_FOUND':
    case 'BRANCH_NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return 404;
    case 'NETWORK_TIMEOUT': return 504;
    default: return 400;
  }
}

export function sendGitSourceError(res: Response, err: unknown): void {
  if (err instanceof GitSourceError) {
    res.status(gitSourceStatus(err.code)).json({ error: err.message, code: err.code });
    return;
  }
  console.error('[GitSource] Unexpected error:', err);
  res.status(500).json({ error: 'Git source operation failed' });
}
