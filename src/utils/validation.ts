import { z } from 'zod';
import { ACTIVITY_TYPES } from '../types';

// --- Baby Schema ---
export const babySchema = z.object({
  name: z.string().min(1).max(50),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD形式で入力してください')
    .refine(
      (val) => {
        const d = new Date(val);
        return !isNaN(d.getTime()) && d <= new Date();
      },
      { message: '過去の日付を入力してください' },
    )
    .refine(
      (val) => {
        const d = new Date(val);
        const sixYearsAgo = new Date();
        sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
        return d >= sixYearsAgo;
      },
      { message: '6年以内の日付を入力してください' },
    ),
});

// --- Activity Log Schema ---
const activityLogSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  timestamp: z.string().min(1),
  leftBreastMinutes: z.number().int().min(0).max(60).optional(),
  rightBreastMinutes: z.number().int().min(0).max(60).optional(),
  amountML: z.number().int().min(0).max(500).optional(),
  sleepEnd: z.string().nullable().optional(),
  hasPee: z.boolean().optional(),
  hasPoop: z.boolean().optional(),
  temperature: z.number().min(34.0).max(42.0).optional(),
  note: z.string().max(500).optional(),
});

// --- Advice Request Schema ---
export const adviceRequestSchema = z.object({
  baby: babySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activityLogs: z.array(activityLogSchema).max(200),
});

// --- Chat Request Schema ---
export const chatRequestSchema = z.object({
  baby: babySchema,
  message: z.string().min(1).max(2000),
  previousResponseId: z
    .string()
    .regex(/^resp_/, 'previousResponseIdは resp_ で始まる必要があります')
    .optional(),
  activityLogs: z.array(activityLogSchema).max(200),
});
