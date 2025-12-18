import { z } from 'zod'

export const StartPayload = z.object({
  userId: z.string().uuid().optional(),
  targetCompany: z.string().optional().nullable(),
  targetRole: z.string().optional().nullable(),
  jdText: z.string().optional().nullable(),
  // 放宽为可选且可为 null；前端未上传成功时可不传或传 null
  resumeFileUrl: z.string().min(1).optional().nullable(),
  role: z.enum(['HR','业务负责人','技术']),
  style: z.enum(['友好','中性','严格']),
  duration: z.number().int().positive(),
  // 解析后的简历摘要，可选且可为 null
  resumeSummary: z.any().optional().nullable()
})

export const Question = z.object({
  id: z.string().uuid(),
  interviewId: z.string().uuid(),
  orderNo: z.number().int(),
  topic: z.string(),
  text: z.string(),
  intent: z.string().optional().nullable(),
  rubricRef: z.string().optional().nullable()
})

export const AnswerInput = z.object({
  interviewId: z.string().uuid(),
  questionId: z.string().uuid(),
  turnNo: z.number().int().min(1),
  content: z.string().min(1)
})