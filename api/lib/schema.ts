import { z } from 'zod';

export const StartPayload = z.object({
  userId: z.string().uuid().optional(), // MVP 可为空
  targetCompany: z.string().optional(),
  targetRole: z.string().optional(),
  jdText: z.string().optional(),
  resumeFileUrl: z.string().optional(),
  role: z.enum(['HR','业务负责人','技术']),
  style: z.enum(['友好','中性','严格']),
  duration: z.number().int().positive(),
  resumeSummary: z.any().optional()
});

export const Question = z.object({
  id: z.string().uuid(),
  interviewId: z.string().uuid(),
  orderNo: z.number().int(),
  topic: z.string(),
  text: z.string(),
  intent: z.string().optional().nullable(),
  rubricRef: z.string().optional().nullable()
});

export const AnswerInput = z.object({
  interviewId: z.string().uuid(),
  questionId: z.string().uuid(),
  turnNo: z.number().int().min(1),
  content: z.string().min(1)
});