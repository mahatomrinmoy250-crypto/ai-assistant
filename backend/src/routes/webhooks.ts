import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authMiddleware);

const SUPPORTED_EVENTS = [
  'call.started',
  'call.ended',
  'call.failed',
  'booking.created',
];

const createSchema = z.object({
  url: z.string().url('Valid URL required'),
  events: z.array(z.enum(SUPPORTED_EVENTS as [string, ...string[]]))
    .min(1)
    .default(['booking.created']),
});

// GET /api/webhooks
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { workspaceId: req.user!.workspaceId },
      select: {
        id: true, url: true, events: true, isActive: true, createdAt: true,
        // never expose secret
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ webhooks: endpoints, total: endpoints.length });
  } catch {
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// POST /api/webhooks
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const secret = crypto.randomBytes(32).toString('hex');

    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        workspaceId: req.user!.workspaceId,
        url: parsed.data.url,
        events: parsed.data.events,
        secret,
        isActive: true,
      },
      select: {
        id: true, url: true, events: true, isActive: true, createdAt: true,
        secret: true, // return once on creation
      },
    });

    // secret shown only once — user must save it for HMAC verification
    res.status(201).json({
      ...endpoint,
      _note: 'Save the secret — it will not be shown again. Use it to verify X-Webhook-Signature header.',
    });
  } catch {
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// PATCH /api/webhooks/:id  — enable/disable or change URL/events
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!existing) { res.status(404).json({ error: 'Webhook not found' }); return; }

  const schema = z.object({
    url:      z.string().url().optional(),
    events:   z.array(z.enum(SUPPORTED_EVENTS as [string, ...string[]])).min(1).optional(),
    isActive: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const updated = await prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: parsed.data,
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /api/webhooks/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!existing) { res.status(404).json({ error: 'Webhook not found' }); return; }

  await prisma.webhookEndpoint.delete({ where: { id: existing.id } });
  res.json({ deleted: true });
});

// GET /api/webhooks/supported-events
router.get('/events', (_req: AuthenticatedRequest, res: Response) => {
  res.json({ events: SUPPORTED_EVENTS });
});

// GET /api/webhooks/:id/deliveries  — last 50 delivery attempts
router.get('/:id/deliveries', async (req: AuthenticatedRequest, res: Response) => {
  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!existing) { res.status(404).json({ error: 'Webhook not found' }); return; }

  try {
    const raw = await prisma.webhookDelivery.findMany({
      where: { webhookEndpointId: existing.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, event: true, status: true,
        statusCode: true, createdAt: true,
      },
    });
    const deliveries = raw.map((d) => ({
      id: d.id,
      event: d.event,
      success: d.status === 'success',
      statusCode: d.statusCode ?? undefined,
      createdAt: d.createdAt,
    }));
    res.json({ deliveries });
  } catch {
    res.status(500).json({ error: 'Failed to get deliveries' });
  }
});

export default router;
