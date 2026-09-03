import { z } from 'zod';

export const dateOnlySchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'date must be in YYYY-MM-DD format'
).refine((value) => {
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}, 'invalid date');

export const idSchema = z.coerce.number().int().positive();

export function dateAtUtcStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function nextUtcDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
