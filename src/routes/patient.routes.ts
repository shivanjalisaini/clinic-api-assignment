import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { idSchema } from '../lib/validation';

const router = Router();

const patientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^\d{10}$/, 'phone must contain exactly 10 digits'),
  dateOfBirth: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = patientSchema.parse(req.body);
    const patient = await prisma.patient.create({
      data: {
        name: data.name,
        phone: data.phone,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        gender: data.gender ?? null,
      },
    });
    return res.status(201).json(patient);
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
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const patients = await prisma.patient.findMany({
      where: search ? { name: { startsWith: search, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
    });
    return res.json(patients);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = idSchema.parse(req.params.id);
    const patient = await prisma.patient.findUnique({ where: { id } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    return res.json(patient);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid patient id' });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
