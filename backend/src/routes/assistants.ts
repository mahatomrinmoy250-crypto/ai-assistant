import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';

const router = Router();
router.use(authMiddleware);

const AgentSchema = z.object({
  name: z.string().min(1).max(100),
  language: z.string().optional(),
  systemPrompt: z.string().min(1),
  greetingMessage: z.string().optional(),
  llmModel: z.string().optional(),
  ttsVoice: z.string().optional(),
  maxDurationMinutes: z.number().min(1).max(60).optional(),
  silenceTimeoutSeconds: z.number().min(5).max(120).optional(),
  transferNumber: z.string().optional(),
  enableBooking: z.boolean().optional(),
});

// GET /api/assistants  (agents)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      where: { workspaceId: req.user!.workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(agents);
  } catch {
    res.status(500).json({ error: 'Failed to get agents' });
  }
});

// GET /api/assistants/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const agent = await prisma.agent.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });

    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(agent);
  } catch {
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// POST /api/assistants
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = AgentSchema.parse(req.body);
    const agent = await prisma.agent.create({
      data: { ...data, workspaceId: req.user!.workspaceId },
    });
    res.status(201).json(agent);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to create agent' });
    }
  }
});

// PATCH /api/assistants/:id
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const data = AgentSchema.partial().parse(req.body);
    const agent = await prisma.agent.update({ where: { id: req.params.id as string }, data });
    res.json(agent);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to update agent' });
    }
  }
});

// DELETE /api/assistants/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.agent.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    await prisma.agent.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

export default router;
