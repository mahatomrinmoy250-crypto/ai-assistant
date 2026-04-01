import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authMiddleware);

// ─── Contact Lists ────────────────────────────────────────────────────────────

// GET /api/contact-lists
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const lists = await prisma.contactList.findMany({
      where: { workspaceId: req.user!.workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(lists);
  } catch {
    res.status(500).json({ error: 'Failed to list contact lists' });
  }
});

// POST /api/contact-lists
const createListSchema = z.object({
  name: z.string().min(1).max(100),
});

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createListSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const list = await prisma.contactList.create({
      data: { workspaceId: req.user!.workspaceId, name: parsed.data.name },
    });
    res.status(201).json(list);
  } catch {
    res.status(500).json({ error: 'Failed to create contact list' });
  }
});

// GET /api/contact-lists/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await prisma.contactList.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
      include: {
        contacts: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!list) { res.status(404).json({ error: 'Contact list not found' }); return; }
    res.json(list);
  } catch {
    res.status(500).json({ error: 'Failed to get contact list' });
  }
});

// DELETE /api/contact-lists/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const list = await prisma.contactList.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!list) { res.status(404).json({ error: 'Contact list not found' }); return; }

  try {
    await prisma.contact.deleteMany({ where: { listId: list.id } });
    await prisma.contactList.delete({ where: { id: list.id } });
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete contact list' });
  }
});

// ─── Contacts ─────────────────────────────────────────────────────────────────

const contactSchema = z.object({
  phoneNumber: z.string().min(7).max(20),
  name: z.string().max(100).default(''),
  email: z.string().email().max(255).optional().default(''),
  customFields: z.record(z.string()).default({}),
});

// POST /api/contact-lists/:id/contacts  (add single contact)
router.post('/:id/contacts', async (req: AuthenticatedRequest, res: Response) => {
  const list = await prisma.contactList.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!list) { res.status(404).json({ error: 'Contact list not found' }); return; }

  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const contact = await prisma.contact.create({
      data: {
        workspaceId: req.user!.workspaceId,
        listId: list.id,
        phoneNumber: parsed.data.phoneNumber,
        name: parsed.data.name,
        email: parsed.data.email ?? '',
        customFields: parsed.data.customFields,
      },
    });

    await prisma.contactList.update({
      where: { id: list.id },
      data: { contactCount: { increment: 1 } },
    });

    res.status(201).json(contact);
  } catch {
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// POST /api/contact-lists/:id/contacts/bulk
// Body: { contacts: [ { phoneNumber, name?, email?, customFields? } ] }
// Max 5000 contacts per request
const bulkSchema = z.object({
  contacts: z.array(contactSchema).min(1).max(5000),
});

router.post('/:id/contacts/bulk', async (req: AuthenticatedRequest, res: Response) => {
  const list = await prisma.contactList.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!list) { res.status(404).json({ error: 'Contact list not found' }); return; }

  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  try {
    const workspaceId = req.user!.workspaceId;
    const listId = list.id;

    // Insert in batches of 500
    let inserted = 0;
    const contacts = parsed.data.contacts;

    for (let i = 0; i < contacts.length; i += 500) {
      const batch = contacts.slice(i, i + 500);
      const result = await prisma.contact.createMany({
        data: batch.map((c) => ({
          workspaceId,
          listId,
          phoneNumber: c.phoneNumber,
          name: c.name,
          email: c.email ?? '',
          customFields: c.customFields,
        })),
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    await prisma.contactList.update({
      where: { id: listId },
      data: { contactCount: { increment: inserted } },
    });

    res.status(201).json({ inserted, total: contacts.length });
  } catch {
    res.status(500).json({ error: 'Failed to bulk import contacts' });
  }
});

// DELETE /api/contact-lists/:id/contacts/:contactId
router.delete('/:id/contacts/:contactId', async (req: AuthenticatedRequest, res: Response) => {
  const contact = await prisma.contact.findFirst({
    where: {
      id: req.params.contactId as string,
      listId: req.params.id as string,
      workspaceId: req.user!.workspaceId,
    },
  });
  if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }

  try {
    await prisma.contact.delete({ where: { id: contact.id } });
    await prisma.contactList.update({
      where: { id: req.params.id as string },
      data: { contactCount: { decrement: 1 } },
    });
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

export default router;
