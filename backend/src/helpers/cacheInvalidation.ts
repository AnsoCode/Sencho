import { CacheService } from '../services/CacheService';

/**
 * Drop the per-node caches affected by a stack or container mutation so the
 * next dashboard poll shows fresh state instead of stale reads.
 *
 * Also drops the global `project-name-map` since stack writes (create,
 * delete, rename, compose edits) can reshape the on-disk layout used to
 * build it.
 */
export function invalidateNodeCaches(nodeId: number): void {
  const cache = CacheService.getInstance();
  cache.invalidate(`stats:${nodeId}`);
  cache.invalidate(`stack-statuses:${nodeId}`);
  cache.invalidate('project-name-map');
}
