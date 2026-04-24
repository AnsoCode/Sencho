import { Router, type Request, type Response } from 'express';
import { DatabaseService } from '../services/DatabaseService';
import { authMiddleware } from '../middleware/auth';
import { requireAdmin } from '../middleware/tierGates';
import { isDebugEnabled } from '../utils/debug';

const NOTIFICATION_CHANNEL_TYPES = ['discord', 'slack', 'webhook'] as const;

function validateHttpsUrl(value: unknown): string | null {
  if (!value || typeof value !== 'string' || !value.startsWith('https://')) return 'must be a valid HTTPS URL';
  try { new URL(value); } catch { return 'is not a valid URL'; }
  return null;
}

export const agentsRouter = Router();

agentsRouter.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const nodeId = req.nodeId ?? 0;
    const agents = DatabaseService.getInstance().getAgents(nodeId);
    res.json(agents);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

agentsRouter.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const { type, url, enabled } = req.body;
    if (!type || !(NOTIFICATION_CHANNEL_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: `type must be ${NOTIFICATION_CHANNEL_TYPES.join(', ')}` });
      return;
    }
    const urlErr = validateHttpsUrl(url);
    if (urlErr) { res.status(400).json({ error: `url ${urlErr}` }); return; }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    const nodeId = req.nodeId ?? 0;
    DatabaseService.getInstance().upsertAgent(nodeId, { type, url, enabled });
    console.log(`[Agents] Agent ${type} updated`);
    if (isDebugEnabled()) console.log(`[Agents:diag] Agent ${type} upsert: enabled=${enabled}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});
