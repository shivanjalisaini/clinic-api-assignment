import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { dateAtUtcStart, dateOnlySchema, idSchema, nextUtcDay } from '../lib/validation';

const router = Router();

const createAppointmentSchema = z.object({
  patientId: idSchema,
  doctorId: idSchema,
  date: dateOnlySchema,
  timeSlot: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'timeSlot must be HH:mm'),
});

const statusSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']),
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  BOOKED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

router.post('/', async (req: Request, res: Response) => {
  try {
    const input = createAppointmentSchema.parse(req.body);
    const date = dateAtUtcStart(input.date);

    const [patient, doctor, schedule] = await Promise.all([
      prisma.patient.findUnique({ where: { id: input.patientId } }),
      prisma.doctor.findUnique({ where: { id: input.doctorId } }),
      prisma.doctorSchedule.findUnique({
        where: {
          doctorId_dayOfWeek: {
            doctorId: input.doctorId,
            dayOfWeek: date.getUTCDay(),
          },
        },
      }),
    ]);

    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
    if (!schedule) return res.status(409).json({ error: 'Doctor is not available on this day' });

    const slots = generateTimeSlots(schedule.startTime, schedule.endTime, schedule.slotDuration);
    if (!slots.includes(input.timeSlot)) {
      return res.status(400).json({ error: 'Invalid time slot for this doctor schedule' });
    }

    // Serialize token allocation by day. PostgreSQL advisory locks are held until
    // the transaction ends, preventing two concurrent bookings from receiving
    // the same next token.
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.date}))`;

      const last = await tx.appointment.findFirst({
        where: { date },
        orderBy: { tokenNumber: 'desc' },
        select: { tokenNumber: true },
      });

      const tokenNumber = (last?.tokenNumber ?? 0) + 1;

      return tx.appointment.create({
        data: {
          patientId: input.patientId,
          doctorId: input.doctorId,
          date,
          timeSlot: input.timeSlot,
          tokenNumber,
          status: 'BOOKED',
        },
      });
    });

    return res.status(201).json(appointment);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'The selected slot is already booked' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { status } = statusSchema.parse(req.body);

    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    if (!ALLOWED_TRANSITIONS[appointment.status].includes(status)) {
      return res.status(409).json({
        error: `Invalid status transition: ${appointment.status} -> ${status}`,
      });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status },
    });
    return res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.issues });
    }
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const doctorId = req.query.doctorId ? idSchema.parse(req.query.doctorId) : undefined;
    const date = req.query.date ? dateOnlySchema.parse(req.query.date) : undefined;

    const where: any = {};
    if (doctorId) where.doctorId = doctorId;
    if (date) {
      const start = dateAtUtcStart(date);
      where.date = { gte: start, lt: nextUtcDay(start) };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: [{ date: 'asc' }, { tokenNumber: 'asc' }],
    });
    return res.json(appointments);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid query parameters', details: error.issues });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = idSchema.parse(req.params.id);
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { patient: true, doctor: true },
    });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    return res.json(appointment);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid appointment id' });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

function generateTimeSlots(start: string, end: string, durationMinutes: number): string[] {
  const slots: string[] = [];
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  let current = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  while (current + durationMinutes <= endMinutes) {
    slots.push(`${Math.floor(current / 60).toString().padStart(2, '0')}:${(current % 60).toString().padStart(2, '0')}`);
    current += durationMinutes;
  }
  return slots;
}

export default router;
