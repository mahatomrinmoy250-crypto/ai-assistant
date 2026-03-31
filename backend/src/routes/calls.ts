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
  assistantId: z.string(),
  toNumber: z.string().min(10),
  fromNumber: z.string().optional(),
});

// GET /api/calls
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const where: Record<string, unknown> = { userId: req.user!.id };
    if (status) where.status = status;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        include: {
          assistant: { select: { id: true, name: true } },
          phoneNumber: { select: { id: true, number: true, friendlyName: true } },
          messages: { select: { id: true, role: true, content: true, timestamp: true } },
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
      where: { id: req.params.id, userId: req.user!.id },
      include: {
        assistant: true,
        phoneNumber: true,
        messages: { orderBy: { timestamp: 'asc' } },
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
    const { assistantId, toNumber, fromNumber } = CreateCallSchema.parse(req.body);

    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, userId: req.user!.id },
    });
    if (!assistant) {
      res.status(404).json({ error: 'Assistant not found' });
      return;
    }

    // Create call record first (we need the ID for the answer URL)
    const call = await prisma.call.create({
      data: {
        userId: req.user!.id,
        assistantId,
        type: 'OUTBOUND',
        status: 'QUEUED',
        toNumber,
        fromNumber: fromNumber || config.vobiz.defaultFromNumber,
      },
    });

    // Answer URL returns XML with <Stream> pointing to our WebSocket
    const answerUrl = `${config.vobiz.webhookBaseUrl}/api/calls/${call.id}/answer`;

    const vobizCallUuid = await vobizService.makeCall(
      toNumber,
      fromNumber || config.vobiz.defaultFromNumber,
      answerUrl
    );

    const updatedCall = await prisma.call.update({
      where: { id: call.id },
      data: { twilioCallSid: vobizCallUuid, status: 'RINGING' },
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
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    const session = getSession(call.id);
    if (session) await session.end('CANCELED');

    if (call.twilioCallSid) {
      try {
        await vobizService.hangupCall(call.twilioCallSid);
      } catch { /* ignore if already ended */ }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// ─── Vobiz Webhooks ───────────────────────────────────────────────────────────

/**
 * POST /api/calls/inbound
 * Vobiz calls this when an inbound call arrives on a purchased number.
 * We return XML with <Stream> to connect the call to our WebSocket.
 */
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const { To, From, CallUUID } = req.body;

    const phoneNumber = await prisma.phoneNumber.findUnique({
      where: { number: To },
      include: { assistant: true, user: true },
    });

    if (!phoneNumber?.assistant) {
      res.type('text/xml').send(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Speak>This number is not configured. Goodbye.</Speak><Hangup/></Response>'
      );
      return;
    }

    const call = await prisma.call.create({
      data: {
        userId: phoneNumber.userId,
        assistantId: phoneNumber.assistant.id,
        phoneNumberId: phoneNumber.id,
        type: 'INBOUND',
        status: 'RINGING',
        toNumber: To,
        fromNumber: From,
        twilioCallSid: CallUUID,
      },
    });

    const xml = vobizService.generateInboundXML(call.id);
    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('[Calls] Inbound webhook error:', err);
    res.type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Speak>An error occurred.</Speak><Hangup/></Response>'
    );
  }
});

/**
 * GET/POST /api/calls/:id/answer
 * Answer URL for outbound calls — Vobiz requests this when the callee picks up.
 */
router.all('/:id/answer', async (req: Request, res: Response) => {
  try {
    const call = await prisma.call.findUnique({ where: { id: req.params.id } });
    if (!call) {
      res.status(404).send('Call not found');
      return;
    }

    const xml = vobizService.generateOutboundXML(call.id);
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

    const statusMap: Record<string, string> = {
      'answer': 'IN_PROGRESS',
      'ringing': 'RINGING',
      'completed': 'COMPLETED',
      'busy': 'BUSY',
      'no-answer': 'NO_ANSWER',
      'canceled': 'CANCELED',
      'failed': 'FAILED',
    };

    const status = statusMap[CallStatus?.toLowerCase()] || 'FAILED';

    await prisma.call.updateMany({
      where: { twilioCallSid: CallUUID },
      data: {
        status: status as 'QUEUED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'BUSY' | 'NO_ANSWER' | 'CANCELED',
        ...(Duration ? { duration: parseInt(Duration) } : {}),
        ...(status === 'COMPLETED' ? { endedAt: new Date() } : {}),
      },
    });

    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

export default router;
