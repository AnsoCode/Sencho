import type { Response } from 'express';
import { FleetSyncService } from '../services/FleetSyncService';

/**
 * Reject mutation attempts on a replica Sencho. Returns true (and writes a
 * 403 response) when this instance is acting as a replica; the caller
 * should `return` immediately. Returns false on a control instance so the
 * route handler can continue.
 *
 * Replicas mirror security configuration (scan policies, CVE suppressions)
 * from the control node and reject local writes to keep the fleet
 * authoritative source single.
 */
export function blockIfReplica(res: Response, resource: string): boolean {
  if (FleetSyncService.getRole() === 'replica') {
    res.status(403).json({
      error: `Cannot modify ${resource} on a replica instance. Connect to the primary.`,
      code: 'REPLICA_READ_ONLY',
    });
    return true;
  }
  return false;
}
