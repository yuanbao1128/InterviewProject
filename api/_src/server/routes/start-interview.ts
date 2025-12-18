import { Hono } from 'hono'
import { query } from '../lib/db.js'
import { client, MODEL } from '../lib/llm.js'
import { StartPayload } from '../lib/schema.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditLLM } from '../lib/util.js'

const r = new Hono()

function resolvePrompt(...segments: string[]) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  return path.join(__dirname, '..', 'lib', 'prompts', ...segments)
}

function maxFollowupsByDuration(mins: number) {
  return mins <= 15 ? 1 : 2
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

  const t0 = Date.now()
  let list: any[] = []
  try {
    const res = await client.chat.chat.completions.create({
      // 兼容包统一用 client.chat.completions
    } as any)
  } catch {}
  // 兼容 openai sdk 正确写法：
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '请生成问题清单（5-8题），包含order_no, topic, text, intent, rubric_ref。' }
      ],
      temperature: 0.3
    })

    const latency = Date.now() - t0
    try {
      list = JSON.parse(res.choices[0]?.message?.content || '[]')
    } catch {
      list = []
    }

    await auditLLM(query, {
      interviewId,
      phase: 'planning',
      model: MODEL,
      promptTokens: res.usage?.prompt_tokens ?? null,
      completionTokens: res.usage?.completion_tokens ?? null,
      totalTokens: res.usage?.total_tokens ?? null,
      latencyMs: latency,
      success: true,
      error: null
    })
  } catch (e: any) {
    list = []
    await auditLLM(query, {
      interviewId,
      phase: 'planning',
      model: MODEL,
      latencyMs: Date.now() - t0,
      success: false,
      error: String(e?.message || e)
    })
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

  // 插入 questions
  for (const q of list) {
    await query(
      `insert into app.questions (interview_id, order_no, topic, text, intent, rubric_ref)
       values ($1, $2, $3, $4, $5, $6)`,
      [interviewId, q.order_no, q.topic, q.text, q.intent || null, q.rubric_ref || null]
    )
  }

  // 保存规划与进度
  await query(
    `update app.interviews
        set planning = $1,
            progress_state = $2
      where id = $3`,
    [
      JSON.stringify(list),
      JSON.stringify({
        current: 1,
        total: list.length,
        followups_left: maxFollowupsByDuration(payload.duration)
      }),
      interviewId
    ]
  )

  return c.json({ ok: true, data: { interviewId, total: list.length } })
})

export default r