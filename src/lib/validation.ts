import { z } from 'zod';

export const birthDetailsSchema = z.object({
  fullName: z.string().min(1).max(120),
  dateOfBirth: z.string().min(1).max(40),
  timeOfBirth: z.string().min(1).max(20),
  placeOfBirth: z.string().min(1).max(160),
  email: z.string().email().max(200),
  questions: z.array(z.string().min(1).max(300)).max(6).optional().default([]),
});

export type BirthDetailsInput = z.infer<typeof birthDetailsSchema>;

export const followupSchema = z.object({
  reference: z.string().min(10).max(4000),
  email: z.string().email().max(200),
  questions: z.array(z.string().min(1).max(300)).length(2),
});

export type FollowupInput = z.infer<typeof followupSchema>;
