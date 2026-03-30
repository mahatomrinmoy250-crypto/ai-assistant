import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { twilioService } from '../services/telephony/twilio';
import { config } from '../config';

const router = Router();
router.use(authMiddleware);

// GET /api/phone-numbers
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const numbers = await prisma.phoneNumber.findMany({
      where: { userId: req.user!.id },
      include: { assistant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(numbers);
  } catch {
    res.status(500).json({ error: 'Failed to get phone numbers' });
  }
});

// GET /api/phone-numbers/available
router.get('/available', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { areaCode = '415', limit = '10' } = req.query;
    const numbers = await twilioService.listAvailableNumbers(
      areaCode as string,
      parseInt(limit as string)
    );
    res.json(
      numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        region: n.region,
        locality: n.locality,
      }))
    );
  } catch (err) {
    console.error('[PhoneNumbers] Error listing available numbers:', err);
    res.status(500).json({ error: 'Failed to get available numbers' });
  }
});

// POST /api/phone-numbers (purchase)
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { areaCode } = z
      .object({ areaCode: z.string().optional() })
      .parse(req.body);

    const { sid, number, friendlyName } = await twilioService.purchasePhoneNumber(
      areaCode || '415'
    );

    const phoneNumber = await prisma.phoneNumber.create({
      data: {
        number,
        friendlyName,
        twilioSid: sid,
        userId: req.user!.id,
      },
    });

    res.status(201).json(phoneNumber);
  } catch (err) {
    console.error('[PhoneNumbers] Error purchasing number:', err);
    res.status(500).json({ error: 'Failed to purchase phone number' });
  }
});

// PATCH /api/phone-numbers/:id (assign assistant)
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.phoneNumber.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Phone number not found' });
      return;
    }

    const { assistantId } = z
      .object({ assistantId: z.string().nullable() })
      .parse(req.body);

    if (assistantId) {
      const assistant = await prisma.assistant.findFirst({
        where: { id: assistantId, userId: req.user!.id },
      });
      if (!assistant) {
        res.status(404).json({ error: 'Assistant not found' });
        return;
      }
    }

    const phoneNumber = await prisma.phoneNumber.update({
      where: { id: req.params.id },
      data: { assistantId },
      include: { assistant: { select: { id: true, name: true } } },
    });

    // Update Twilio webhook
    if (existing.twilioSid) {
      await twilioService.updatePhoneWebhook(
        existing.twilioSid,
        `${config.twilio.webhookBaseUrl}/api/calls/inbound`
      );
    }

    res.json(phoneNumber);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to update phone number' });
    }
  }
});

// DELETE /api/phone-numbers/:id (release)
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const existing = await prisma.phoneNumber.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Phone number not found' });
      return;
    }

    if (existing.twilioSid) {
      await twilioService.releasePhoneNumber(existing.twilioSid);
    }

    await prisma.phoneNumber.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to release phone number' });
  }
});

export default router;
