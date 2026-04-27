import { Router, type Request, type Response } from 'express';
// @ts-ignore - composerize lacks proper type definitions
import composerize from 'composerize';
import { authMiddleware } from '../middleware/auth';
import { sanitizeForLog } from '../utils/safeLog';

const MAX_DOCKER_RUN_LENGTH = 8192;

export const convertRouter = Router();

convertRouter.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { dockerRun } = req.body ?? {};
  if (typeof dockerRun !== 'string') {
    res.status(400).json({ error: 'dockerRun must be a string' });
    return;
  }
  const trimmed = dockerRun.trim();
  if (trimmed.length === 0) {
    res.status(400).json({ error: 'dockerRun command is required' });
    return;
  }
  if (trimmed.length > MAX_DOCKER_RUN_LENGTH) {
    res.status(400).json({ error: `dockerRun command is too long (max ${MAX_DOCKER_RUN_LENGTH} characters)` });
    return;
  }
  if (trimmed.includes('\0')) {
    res.status(400).json({ error: 'dockerRun command contains invalid characters' });
    return;
  }

  let yaml: unknown;
  try {
    yaml = composerize(trimmed);
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(422).json({ error: 'Could not parse command. Check syntax and supported flags.' });
    return;
  }

  if (typeof yaml !== 'string' || !yaml.includes('services:')) {
    console.warn('Converter produced unexpected output for input:', sanitizeForLog(trimmed.slice(0, 200)));
    res.status(422).json({ error: 'Could not parse command. Check syntax and supported flags.' });
    return;
  }

  res.json({ yaml });
});
