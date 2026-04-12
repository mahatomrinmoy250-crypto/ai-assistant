import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { VobizService } from '../services/telephony/vobiz';
import { config } from '../config';

const router = Router();
router.use(authMiddleware);

// GET /api/phone-numbers
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const numbers = await prisma.phoneNumber.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(numbers);
  } catch {
    res.status(500).json({ error: 'Failed to get phone numbers' });
  }
});

// GET /api/phone-numbers/available?countryCode=IN
router.get('/available', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { countryCode = 'IN', limit = '10' } = _req.query;
    const workspace = await prisma.workspace.findUnique({ where: { id: _req.user!.workspaceId } });
    if (!workspace?.vobizAuthId || !workspace?.vobizAuthToken) {
      res.status(400).json({ error: 'Vobiz credentials not configured. Go to Settings to add your Auth ID and Auth Token.' });
      return;
    }
    const wsVobiz = VobizService.forWorkspace(workspace);
    const numbers = await wsVobiz.listAvailableNumbers(
      countryCode as string,
      parseInt(limit as string)
    );
    res.json(numbers);
  } catch (err) {
    console.error('[PhoneNumbers] Error listing available numbers:', err);
    res.status(500).json({ error: 'Failed to get available numbers' });
  }
});

// POST /api/phone-numbers/link — link an existing Vobiz number (no purchase)
router.post('/link', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { number } = z.object({ number: z.string().min(5) }).parse(req.body);

    const existing = await prisma.phoneNumber.findFirst({
      where: { number, workspaceId: req.user!.workspaceId },
    });
    if (existing) {
      res.status(409).json({ error: 'This number is already linked to your account' });
      return;
    }

    const phoneNumber = await prisma.phoneNumber.create({
      data: {
        number,
        workspaceId: req.user!.workspaceId,
        provider: 'vobiz',
      },
    });

    res.status(201).json(phoneNumber);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to link phone number' });
    }
  }
});

// POST /api/phone-numbers — purchase a number
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { number } = z.object({ number: z.string() }).parse(req.body);
    const workspace = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });
    if (!workspace?.vobizAuthId || !workspace?.vobizAuthToken) {
      res.status(400).json({ error: 'Vobiz credentials not configured. Go to Settings to add your Auth ID and Auth Token.' });
      return;
    }
    const wsVobiz = VobizService.forWorkspace(workspace);

    const { uuid, number: purchased } = await wsVobiz.purchasePhoneNumber(number);

    await wsVobiz.updateNumberWebhook(
      uuid,
      `${config.vobiz.webhookBaseUrl}/api/calls/inbound`
    );

    const phoneNumber = await prisma.phoneNumber.create({
      data: {
        number: purchased,
        sipTrunkId: uuid,
        workspaceId: req.user!.workspaceId,
      },
    });

    res.status(201).json(phoneNumber);
  } catch (err) {
    console.error('[PhoneNumbers] Purchase error:', err);
    res.status(500).json({ error: 'Failed to purchase phone number' });
  }
});

// PATCH /api/phone-numbers/:id — assign agent
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.phoneNumber.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Phone number not found' });
      return;
    }

    const { agentId } = z.object({ agentId: z.string().uuid().nullable() }).parse(req.body);

    if (agentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId: req.user!.workspaceId },
      });
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
    }

    const phoneNumber = await prisma.phoneNumber.update({
      where: { id: req.params.id as string },
      data: { agentId },
      include: { agent: { select: { id: true, name: true } } },
    });

    res.json(phoneNumber);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to update phone number' });
    }
  }
});

// DELETE /api/phone-numbers/:id — release
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.phoneNumber.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Phone number not found' });
      return;
    }

    if (existing.sipTrunkId) {
      const workspace = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId } });
      const wsVobiz = VobizService.forWorkspace(workspace || {});
      await wsVobiz.releasePhoneNumber(existing.sipTrunkId);
    }

    await prisma.phoneNumber.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to release phone number' });
  }
});

export default router;
