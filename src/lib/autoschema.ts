import { z } from 'zod';

export const AutoBody = z.object({
  name: z.string().trim().min(1, 'Назовите задачу').max(100),
  description: z.string().trim().max(200).default(''),
  prompt: z.string().trim().min(1, 'Напишите запрос').max(20_000),
  modelId: z.string(),
  levelId: z.string(),
  cron: z.string().trim().max(100),
  timezone: z.string().max(64).optional(),
  targetThreadId: z.string().nullable().optional(),
});
