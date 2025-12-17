import { Hono } from 'hono'
import { query } from '../lib/db.js'
import { client, MODEL } from '../lib/llm.js'
import { StartPayload } from '../lib/schema.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const r = new Hono()

function resolvePrompt(...segments: string[]) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  return path.join(__dirname, '..', 'lib', 'prompts', ...segments)
}

r.post('/start-interview', async (c) => {
  const body = await c.req.json()
  const payload = StartPayload.parse(body)

  const { rows: ir } = await query<{ id: string }>(
    `insert into app.interviews
      (user_id, title, role, style, duration_minutes, target_company, target_role, jd_text, resume_file_url, resume_summary, status, started_at)
     values
      (null, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'ongoing', now())
     returning id`,
    [
      `${payload.role} | ${payload.style} | ${payload.duration}分钟`,
      payload.role,
      payload.style,
      payload.duration,
      payload.targetCompany || null,
      payload.targetRole || null,
      payload.jdText || null,
      payload.resumeFileUrl || null,
      payload.resumeSummary ? JSON.stringify(payload.resumeSummary) : null
    ]
  )
  const interviewId = ir[0].id

  const planningPromptPath = resolvePrompt('planning.md')
  const planningPrompt = await fs.readFile(planningPromptPath, 'utf-8')
  const sys =
    `${planningPrompt}\n请严格输出 JSON。上下文：\n` +
    `JD:\n${payload.jdText || ''}\n` +
    `简历要点:\n${JSON.stringify(payload.resumeSummary || {})}`

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: '请生成问题清单（5-8题），包含order_no, topic, text, intent, rubric_ref。' }
    ],
    temperature: 0.3
  })

  let list: any[] = []
  try {
    list = JSON.parse(res.choices[0]?.message?.content || '[]')
  } catch {
    list = []
  }

  if (!Array.isArray(list) || list.length === 0) {
    list = Array.from({ length: 5 }).map((_, i) => ({
      order_no: i + 1,
      topic: i === 0 ? '自我介绍' : '经历深挖',
      text:
        i === 0
          ? '请做一个简要自我介绍，并说明你为什么适合该岗位？'
          : `请详细说明一个你主导的项目（第${i}个），你的目标、动作、结果与复盘。`,
      intent: '基础面',
      rubric_ref: 'default'
    }))
  }

  for (const q of list) {
    await query(
      `insert into app.questions (interview_id, order_no, topic, text, intent, rubric_ref)
       values ($1, $2, $3, $4, $5, $6)`,
      [interviewId, q.order_no, q.topic, q.text, q.intent || null, q.rubric_ref || null]
    )
  }

  return c.json({ ok: true, data: { interviewId, total: list.length } })
})

export default r