import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest, CreateAssistantDto } from '../types';

const router = Router();
router.use(authMiddleware);

const AssistantSchema = z.object({
  name: z.string().min(1).max(100),
  systemPrompt: z.string().min(1),
  firstMessage: z.string().optional(),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  llmTemperature: z.number().min(0).max(1).optional(),
  llmMaxTokens: z.number().min(1).max(4096).optional(),
  sttProvider: z.string().optional(),
  sttLanguage: z.string().optional(),
  sttModel: z.string().optional(),
  ttsProvider: z.string().optional(),
  ttsVoiceId: z.string().optional(),
  ttsModel: z.string().optional(),
  ttsStability: z.number().min(0).max(1).optional(),
  ttsSimilarity: z.number().min(0).max(1).optional(),
  ttsSpeed: z.number().min(0.5).max(2).optional(),
  endCallMessage: z.string().optional(),
  endCallPhrases: z.array(z.string()).optional(),
  maxCallDuration: z.number().min(60).max(14400).optional(),
  webhookUrl: z.string().url().optional(),
});

// GET /api/assistants
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assistants = await prisma.assistant.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(assistants);
  } catch {
    res.status(500).json({ error: 'Failed to get assistants' });
  }
});

// GET /api/assistants/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assistant = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!assistant) {
      res.status(404).json({ error: 'Assistant not found' });
      return;
    }

    res.json(assistant);
  } catch {
    res.status(500).json({ error: 'Failed to get assistant' });
  }
});

// POST /api/assistants
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = AssistantSchema.parse(req.body) as CreateAssistantDto;

    const assistant = await prisma.assistant.create({
      data: {
        ...data,
        userId: req.user!.id,
      },
    });

    res.status(201).json(assistant);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to create assistant' });
    }
  }
});

// PATCH /api/assistants/:id
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Assistant not found' });
      return;
    }

    const data = AssistantSchema.partial().parse(req.body);
    const assistant = await prisma.assistant.update({
      where: { id: req.params.id },
      data,
    });

    res.json(assistant);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to update assistant' });
    }
  }
});

// DELETE /api/assistants/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.assistant.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Assistant not found' });
      return;
    }

    await prisma.assistant.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete assistant' });
  }
});

export default router;
