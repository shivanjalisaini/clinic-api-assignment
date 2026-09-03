import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { dateAtUtcStart, dateOnlySchema, idSchema } from '../lib/validation';

const router = Router();

router.get('/:id/slots', async (req: Request, res: Response) => {
  try {
    const doctorId = idSchema.parse(req.params.id);
    const date = dateOnlySchema.parse(req.query.date);
    const requestedDate = dateAtUtcStart(date);
    const dayOfWeek = requestedDate.getUTCDay();

    const schedule = await prisma.doctorSchedule.findUnique({
      where: { doctorId_dayOfWeek: { doctorId, dayOfWeek } },
    });

    if (!schedule) {
      return res.status(200).json({ slots: [], message: 'Doctor not available on this day' });
    }

    const allSlots = generateTimeSlots(schedule.startTime, schedule.endTime, schedule.slotDuration);
    const end = new Date(requestedDate.getTime() + 24 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId,
        date: { gte: requestedDate, lt: end },
        status: { in: ['BOOKED', 'COMPLETED'] },
      },
      select: { timeSlot: true },
    });

    const booked = new Set(appointments.map((a) => a.timeSlot));
    return res.json({ slots: allSlots.filter((slot) => !booked.has(slot)) });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid request parameters', details: error });
    }
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function generateTimeSlots(start: string, end: string, durationMinutes: number): string[] {
  const slots: string[] = [];
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  let currentMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  while (currentMinutes + durationMinutes <= endMinutes) {
    const h = Math.floor(currentMinutes / 60);
    const m = currentMinutes % 60;
    slots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
    currentMinutes += durationMinutes;
  }
  return slots;
}

export default router;
