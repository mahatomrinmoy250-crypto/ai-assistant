import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { vobizService } from '../services/telephony/vobiz';
import { config } from '../config';
import { getSession } from '../services/call-session';

const router = Router();

const CreateCallSchema = z.object({
  agentId: z.string().uuid(),
  toNumber: z.string().min(10),
  fromNumber: z.string().optional(),
});

// GET /api/calls
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = { workspaceId: req.user!.workspaceId };
    if (status) where.status = status;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        include: {
          agent: { select: { id: true, name: true } },
          messages: { select: { id: true, role: true, content: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit as string),
      }),
      prisma.call.count({ where }),
    ]);

    res.json({
      calls,
      total,
      page: parseInt(page as string),
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch {
    res.status(500).json({ error: 'Failed to get calls' });
  }
});

// GET /api/calls/:id
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
      include: {
        agent: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }
    res.json(call);
  } catch {
    res.status(500).json({ error: 'Failed to get call' });
  }
});

// POST /api/calls — initiate outbound call
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, toNumber, fromNumber } = CreateCallSchema.parse(req.body);

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, workspaceId: req.user!.workspaceId },
    });
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const from = fromNumber || config.vobiz.defaultFromNumber;

    // Create call record first (need the ID for the answer URL)
    const call = await prisma.call.create({
      data: {
        workspaceId: req.user!.workspaceId,
        agentId,
        direction: 'outbound',
        type: 'manual',
        status: 'queued',
        phoneNumber: toNumber,
        fromNumber: from,
      },
    });

    const answerUrl = `${config.vobiz.webhookBaseUrl}/api/calls/${call.id}/answer`;

    const vobizCallUuid = await vobizService.makeCall(toNumber, from, answerUrl);

    const updatedCall = await prisma.call.update({
      where: { id: call.id },
      data: { vobizCallUuid, status: 'queued' },
    });

    res.status(201).json(updatedCall);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      console.error('[Calls] Outbound call error:', err);
      res.status(500).json({ error: 'Failed to initiate call' });
    }
  }
});

// DELETE /api/calls/:id — hang up
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
    });
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const session = getSession(call.id);
    if (session) await session.end('canceled');

    if (call.vobizCallUuid) {
      try {
        await vobizService.hangupCall(call.vobizCallUuid);
      } catch { /* ignore if already ended */ }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// ─── Vobiz Webhooks (no auth — called by Vobiz servers) ──────────────────────

/**
 * POST /api/calls/inbound
 * Vobiz calls this when an inbound call arrives on a purchased number.
 * Returns XML with <Stream> to connect the call to our WebSocket.
 */
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const { To, From, CallUUID } = req.body;

    const phoneNumber = await prisma.phoneNumber.findFirst({
      where: { number: To, isActive: true },
      include: { agent: true },
    });

    if (!phoneNumber?.agent) {
      res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Speak>This number is not configured. Goodbye.</Speak><Hangup/></Response>'
      );
      return;
    }

    const call = await prisma.call.create({
      data: {
        workspaceId: phoneNumber.workspaceId ?? '',
        agentId: phoneNumber.agent.id,
        direction: 'inbound',
        type: 'manual',
        status: 'queued',
        phoneNumber: From,
        fromNumber: To,
        vobizCallUuid: CallUUID,
      },
    });

    const xml = vobizService.generateInboundXML(call.id);
    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('[Calls] Inbound webhook error:', err);
    res.type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response><Speak>An error occurred.</Speak><Hangup/></Response>'
    );
  }
});

/**
 * GET/POST /api/calls/:id/answer
 * Answer URL for outbound calls — Vobiz requests this when callee picks up.
 */
router.all('/:id/answer', async (req: Request, res: Response) => {
  try {
    const call = await prisma.call.findUnique({ where: { id: req.params.id as string } });
    if (!call) {
      res.status(404).send('Call not found');
      return;
    }

    const xml = vobizService.generateInboundXML(call.id);
    res.type('text/xml').send(xml);
  } catch {
    res.status(500).send('Error');
  }
});

/**
 * POST /api/calls/status
 * Vobiz hangup/status callback — updates call status in DB.
 */
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { CallUUID, CallStatus, Duration } = req.body;

    const terminalStatuses = ['completed', 'busy', 'no-answer', 'canceled', 'failed'];
    const status = CallStatus?.toLowerCase() ?? 'failed';

    await prisma.call.updateMany({
      where: { vobizCallUuid: CallUUID },
      data: {
        status,
        ...(Duration ? { durationSeconds: parseInt(Duration) } : {}),
        ...(terminalStatuses.includes(status) ? { endedAt: new Date() } : {}),
      },
    });

    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

export default router;
