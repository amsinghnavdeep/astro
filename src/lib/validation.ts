import { z } from 'zod';

/**
 * Invisible safety ceiling on the free-text "ask anything" box. Never shown to
 * the customer; it only stops a pasted essay from bloating a fulfilment session.
 */
export const QUESTIONS_MAX_CHARS = 1000;

export const personSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  gender: z.enum(['Male', 'Female', 'Other']),
  dateOfBirth: z.string().min(1).max(40),
  timeOfBirth: z.string().min(1).max(20),
  placeOfBirth: z.string().trim().min(1).max(160),
  timezone: z.string().min(1).max(64),
});

export type PersonInput = z.infer<typeof personSchema>;

export const birthDetailsSchema = personSchema
  .extend({
    email: z.string().email().max(200),
    questions: z.string().trim().max(QUESTIONS_MAX_CHARS).optional().default(''),
    twoPeople: z.boolean().optional().default(false),
    partner: personSchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.twoPeople && !d.partner) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['partner'],
        message: 'Second person birth details are required for a two-person reading.',
      });
    }
  })
  .transform((d) => ({ ...d, partner: d.twoPeople ? d.partner : undefined }));

export type BirthDetailsInput = z.infer<typeof birthDetailsSchema>;

export const followupSchema = z.object({
  reference: z.string().min(10).max(4000),
  email: z.string().email().max(200),
  // One free-text block. A string array (older clients) is joined with newlines;
  // the output stays a one-element array for the follow-up checkout and lead.
  questions: z
    .preprocess(
      (value) => (Array.isArray(value) ? value.filter((q) => typeof q === 'string').join('\n') : value),
      z.string().trim().min(1).max(QUESTIONS_MAX_CHARS),
    )
    .transform((text) => [text]),
});

export type FollowupInput = z.infer<typeof followupSchema>;
