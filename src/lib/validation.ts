import { z } from 'zod';

const question = z
  .string()
  .min(1)
  .max(140)
  .refine((s) => s.trim().split(/\s+/).length <= 18, 'Max 18 words per question');

export const birthDetailsSchema = z.object({
  fullName: z.string().min(1).max(120),
  gender: z.enum(['Male', 'Female', 'Other']),
  dateOfBirth: z.string().min(1).max(40),
  timeOfBirth: z.string().min(1).max(20),
  placeOfBirth: z.string().min(1).max(160),
  timezone: z.string().min(1).max(64),
  email: z.string().email().max(200),
  questions: z.array(question).max(3).optional().default([]),
});

export type BirthDetailsInput = z.infer<typeof birthDetailsSchema>;

export const followupSchema = z.object({
  reference: z.string().min(10).max(4000),
  email: z.string().email().max(200),
  questions: z.array(question).min(1).max(3),
});

export type FollowupInput = z.infer<typeof followupSchema>;
