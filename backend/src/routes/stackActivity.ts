import { Router, type Request, type Response } from 'express';
import { DatabaseService } from '../services/DatabaseService';
import { requirePermission } from '../middleware/permissions';
import { isValidStackName } from '../utils/validation';

export const stackActivityRouter = Router();

stackActivityRouter.get('/:stackName/activity', (req: Request, res: Response): void => {
  const stackName = req.params.stackName as string;
  if (!isValidStackName(stackName)) {
    res.status(400).json({ error: 'Invalid stack name' });
    return;
  }
  if (!requirePermission(req, res, 'stack:read', 'stack', stackName)) return;
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const before = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
  if (before !== undefined && isNaN(before)) {
    res.status(400).json({ error: 'Invalid before parameter' });
    return;
  }
  const events = DatabaseService.getInstance().getStackActivity(req.nodeId, stackName, { limit, before });
  res.json({ events });
});
