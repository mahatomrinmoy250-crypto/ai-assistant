import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../lib/prisma';
import { startCampaignJobs } from '../lib/campaignWorker';
import { campaignQueue } from '../lib/queue';

const router = Router();
router.use(authMiddleware);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createCampaignSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  agentId: z.string().uuid(),
  phoneNumberId: z.string().uuid(),
  contactListId: z.string().uuid(),
  maxConcurrent: z.number().int().min(1).max(20).default(4),
});

const updateCampaignSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  agentId: z.string().uuid().optional(),
  phoneNumberId: z.string().uuid().optional(),
  contactListId: z.string().uuid().optional(),
  maxConcurrent: z.number().int().min(1).max(20).optional(),
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────

// GET /api/campaigns
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId: req.user!.workspaceId },
      include: {
        agent: { select: { id: true, name: true } },
        phoneNumber: { select: { id: true, number: true } },
        contactList: { select: { id: true, name: true, contactCount: true } },
        _count: { select: { calls: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(campaigns);
  } catch {
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

// POST /api/campaigns
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { name, description, agentId, phoneNumberId, contactListId, maxConcurrent } = parsed.data;
  const workspaceId = req.user!.workspaceId;

  // Verify all resources belong to this workspace
  const [agent, phoneNumber, contactList] = await Promise.all([
    prisma.agent.findFirst({ where: { id: agentId, workspaceId } }),
    prisma.phoneNumber.findFirst({ where: { id: phoneNumberId, workspaceId } }),
    prisma.contactList.findFirst({ where: { id: contactListId, workspaceId } }),
  ]);

  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  if (!phoneNumber) { res.status(404).json({ error: 'Phone number not found' }); return; }
  if (!contactList) { res.status(404).json({ error: 'Contact list not found' }); return; }

  try {
    const campaign = await prisma.campaign.create({
      data: {
        workspaceId,
        name,
        description,
        agentId,
        phoneNumberId,
        contactListId,
        maxConcurrent,
        totalContacts: contactList.contactCount,
      },
    });
    res.status(201).json(campaign);
  } catch {
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// GET /api/campaigns/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
      include: {
        agent: { select: { id: true, name: true } },
        phoneNumber: { select: { id: true, number: true } },
        contactList: { select: { id: true, name: true, contactCount: true } },
        calls: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true, phoneNumber: true, status: true,
            outcome: true, durationSeconds: true, createdAt: true,
          },
        },
      },
    });

    if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
    res.json(campaign);
  } catch {
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

// PATCH /api/campaigns/:id
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

  if (campaign.status === 'running') {
    res.status(400).json({ error: 'Cannot edit a running campaign — pause it first' });
    return;
  }

  try {
    const updated = await prisma.campaign.update({
      where: { id: req.params.id as string },
      data: parsed.data,
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

  if (campaign.status === 'running') {
    res.status(400).json({ error: 'Cannot delete a running campaign — stop it first' });
    return;
  }

  try {
    await prisma.campaign.delete({ where: { id: req.params.id as string } });
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// ─── Campaign Controls ────────────────────────────────────────────────────────

// POST /api/campaigns/:id/start
router.post('/:id/start', async (req: AuthenticatedRequest, res: Response) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

  if (campaign.status === 'running') {
    res.status(400).json({ error: 'Campaign is already running' });
    return;
  }
  if (campaign.status === 'completed') {
    res.status(400).json({ error: 'Campaign is already completed' });
    return;
  }

  try {
    const enqueued = await startCampaignJobs(campaign.id);
    res.json({ started: true, enqueuedCalls: enqueued });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to start campaign' });
  }
});

// POST /api/campaigns/:id/pause
router.post('/:id/pause', async (req: AuthenticatedRequest, res: Response) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

  if (campaign.status !== 'running') {
    res.status(400).json({ error: 'Campaign is not running' });
    return;
  }

  // Pause by marking status — worker checks this before dialing each contact
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'paused' },
  });

  res.json({ paused: true });
});

// POST /api/campaigns/:id/stop
router.post('/:id/stop', async (req: AuthenticatedRequest, res: Response) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }

  if (campaign.status === 'completed' || campaign.status === 'draft') {
    res.status(400).json({ error: `Campaign is already ${campaign.status}` });
    return;
  }

  // Remove pending jobs from queue
  const jobs = await campaignQueue.getJobs(['waiting', 'delayed']);
  const campaignJobs = jobs.filter((j) => j.data.campaignId === campaign.id);
  await Promise.all(campaignJobs.map((j) => j.remove()));

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: 'completed' },
  });

  res.json({ stopped: true, removedJobs: campaignJobs.length });
});

export default router;
