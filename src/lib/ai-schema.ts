import { z } from "zod";

export const studyModeSchema = z.enum([
  "chat",
  "summary",
  "explain",
  "visualize",
  "solve",
  "exam",
  "grade",
  "review",
]);

export const aiRequestSchema = z.object({
  mode: studyModeSchema,
  prompt: z.string().trim().min(2).max(12_000),
  courseIds: z.array(z.string().max(100)).max(6).default([]),
  documentIds: z.array(z.string().max(300)).max(12).default([]),
  retrievalTerms: z
    .array(z.string().trim().min(2).max(160))
    .max(16)
    .default([]),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8_000),
      }),
    )
    .max(10)
    .default([]),
  examOptions: z
    .object({
      questionCount: z.number().int().min(3).max(20).default(8),
      difficulty: z.enum(["basic", "intermediate", "advanced"]).default("intermediate"),
      includeMultipleChoice: z.boolean().default(true),
      includeShortAnswer: z.boolean().default(true),
      includeEssay: z.boolean().default(true),
    })
    .optional(),
});
