import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authMiddleware);

// GET /api/bookings
// ?date=2026-04-05   filter by date
// ?agentId=xxx       filter by agent
// ?status=confirmed
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, agentId, status } = req.query;

    const where: Record<string, unknown> = { workspaceId: req.user!.workspaceId };
    if (date)    where.appointmentDate = String(date);
    if (agentId) where.agentId        = String(agentId);
    if (status)  where.status         = String(status);

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true } },
        call:  { select: { id: true, durationSeconds: true, transcript: true } },
      },
      orderBy: [
        { appointmentDate: 'asc' },
        { appointmentTime: 'asc' },
      ],
    });

    res.json(bookings);
  } catch {
    res.status(500).json({ error: 'Failed to list bookings' });
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
      include: {
        agent: { select: { id: true, name: true } },
        call:  { select: { id: true, durationSeconds: true, transcript: true, messages: true } },
      },
    });

    if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }
    res.json(booking);
  } catch {
    res.status(500).json({ error: 'Failed to get booking' });
  }
});

// PATCH /api/bookings/:id  — update status (cancel/reschedule)
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const booking = await prisma.booking.findFirst({
    where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
  });
  if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }

  const { status, appointmentDate, appointmentTime, notes } = req.body;
  const allowed = ['confirmed', 'cancelled', 'rescheduled'];
  if (status && !allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  try {
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        ...(status          ? { status }          : {}),
        ...(appointmentDate ? { appointmentDate } : {}),
        ...(appointmentTime ? { appointmentTime } : {}),
        ...(notes !== undefined ? { notes }       : {}),
      },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// GET /api/bookings/export/csv
// Downloads all bookings as a CSV file (Excel-compatible)
// ?date=2026-04-05   optional date filter
router.get('/export/csv', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, agentId, status } = req.query;

    const where: Record<string, unknown> = { workspaceId: req.user!.workspaceId };
    if (date)    where.appointmentDate = String(date);
    if (agentId) where.agentId        = String(agentId);
    if (status)  where.status         = String(status);

    const bookings = await prisma.booking.findMany({
      where,
      include: {
        agent: { select: { name: true } },
      },
      orderBy: [
        { appointmentDate: 'asc' },
        { appointmentTime: 'asc' },
      ],
    });

    // Build CSV  (Excel opens UTF-8 CSV with BOM)
    const BOM = '\uFEFF';
    const header = [
      'Booking ID',
      'Patient Name',
      'Patient Phone',
      'Appointment Date',
      'Appointment Time',
      'Status',
      'Agent',
      'Notes',
      'Created At',
    ].join(',');

    const rows = bookings.map((b: {
      id: string; patientName: string; patientPhone: string;
      appointmentDate: string; appointmentTime: string; status: string;
      agent: { name: string } | null; notes: string; createdAt: Date;
    }) => [
      csvCell(b.id),
      csvCell(b.patientName),
      csvCell(b.patientPhone),
      csvCell(b.appointmentDate),
      csvCell(b.appointmentTime),
      csvCell(b.status),
      csvCell(b.agent?.name ?? ''),
      csvCell(b.notes),
      csvCell(b.createdAt.toISOString()),
    ].join(','));

    const csv = BOM + [header, ...rows].join('\r\n');
    const filename = `bookings-${date ?? 'all'}-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch {
    res.status(500).json({ error: 'Failed to export bookings' });
  }
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function csvCell(value: string): string {
  // Wrap in quotes, escape inner quotes
  return `"${String(value).replace(/"/g, '""')}"`;
}

export default router;
