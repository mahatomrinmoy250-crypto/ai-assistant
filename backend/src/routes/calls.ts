import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { twilioService } from '../services/telephony/twilio';
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

// POST /api/calls (outbound call)
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

    // Create call record
    const call = await prisma.call.create({
      data: {
        userId: req.user!.id,
        assistantId,
        type: 'OUTBOUND',
        status: 'QUEUED',
        toNumber,
        fromNumber: fromNumber || config.twilio.phoneNumber,
      },
    });

    // Trigger outbound call via Twilio
    const twimlUrl = `${config.twilio.webhookBaseUrl}/api/calls/${call.id}/twiml`;
    const twilioCallSid = await twilioService.makeCall(
      toNumber,
      fromNumber || config.twilio.phoneNumber,
      twimlUrl
    );

    const updatedCall = await prisma.call.update({
      where: { id: call.id },
      data: { twilioCallSid, status: 'RINGING' },
    });

    res.status(201).json(updatedCall);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      console.error('[Calls] Error creating outbound call:', err);
      res.status(500).json({ error: 'Failed to initiate call' });
    }
  }
});

// DELETE /api/calls/:id (hang up)
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const call = await prisma.call.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!call) {
      res.status(404).json({ error: 'Call not found' });
      return;
    }

    // End the session if active
    const session = getSession(call.id);
    if (session) {
      await session.end('CANCELED');
    }

    // Hang up via Twilio
    if (call.twilioCallSid) {
      try {
        await twilioService.hangupCall(call.twilioCallSid);
      } catch {
        // Ignore if call is already ended
      }
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// POST /api/calls/inbound — Twilio webhook for inbound calls
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const { To, From, CallSid } = req.body;

    // Find phone number and its associated assistant
    const phoneNumber = await prisma.phoneNumber.findUnique({
      where: { number: To },
      include: { assistant: true, user: true },
    });

    if (!phoneNumber?.assistant) {
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>This number is not configured. Goodbye.</Say><Hangup/></Response>`);
      return;
    }

    // Create call record
    const call = await prisma.call.create({
      data: {
        userId: phoneNumber.userId,
        assistantId: phoneNumber.assistant.id,
        phoneNumberId: phoneNumber.id,
        type: 'INBOUND',
        status: 'RINGING',
        toNumber: To,
        fromNumber: From,
        twilioCallSid: CallSid,
      },
    });

    const twiml = twilioService.generateInboundTwiML(call.id);
    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[Calls] Inbound webhook error:', err);
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>An error occurred. Goodbye.</Say><Hangup/></Response>`);
  }
});

// GET /api/calls/:id/twiml — TwiML for outbound calls
router.get('/:id/twiml', async (req: Request, res: Response) => {
  try {
    const call = await prisma.call.findUnique({ where: { id: req.params.id } });

    if (!call) {
      res.status(404).send('Call not found');
      return;
    }

    const twiml = twilioService.generateOutboundTwiML(call.id);
    res.type('text/xml').send(twiml);
  } catch {
    res.status(500).send('Error generating TwiML');
  }
});

// POST /api/calls/status — Twilio status callback
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { CallSid, CallStatus } = req.body;

    const statusMap: Record<string, string> = {
      'initiated': 'QUEUED',
      'ringing': 'RINGING',
      'in-progress': 'IN_PROGRESS',
      'completed': 'COMPLETED',
      'busy': 'BUSY',
      'no-answer': 'NO_ANSWER',
      'canceled': 'CANCELED',
      'failed': 'FAILED',
    };

    const status = statusMap[CallStatus?.toLowerCase()] || 'FAILED';

    await prisma.call.updateMany({
      where: { twilioCallSid: CallSid },
      data: {
        status: status as 'QUEUED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'BUSY' | 'NO_ANSWER' | 'CANCELED',
        ...(status === 'COMPLETED' && { endedAt: new Date() }),
      },
    });

    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

export default router;
