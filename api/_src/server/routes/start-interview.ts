// api/src/server/routes/start-interview.ts
import { Hono } from 'hono'
import { query } from '../lib/db.js'
import { client, MODEL } from '../lib/llm.js'
import { StartPayload } from '../lib/schema.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditLLM } from '../lib/util.js'
import { STORAGE_BUCKET } from '../lib/supabase.js'
import { downloadFromStorage, pdfArrayBufferToText } from '../lib/pdf.js'

const r = new Hono()

function resolvePrompt(...segments: string[]) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  return path.join(__dirname, '..', 'lib', 'prompts', ...segments)
}

function maxFollowupsByDuration(mins: number) {
  return mins <= 15 ? 1 : 2
}

// 与 /parse-resume 相同提示词，用于服务端自动解析 PDF 文本
async function parseResumeTextToSummary(text: string, interviewId?: string) {
  const sys =
    '你是资深招聘顾问，请将简历要点结构化提炼，输出 JSON：' +
    '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}'
  const t0 = Date.now()
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text }
      ],
      temperature: 0.2
    })
    const latency = Date.now() - t0
    const content = res.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)

    await auditLLM(query, {
      interviewId: interviewId || null,
      phase: 'parse',
      model: MODEL,
      promptTokens: res.usage?.prompt_tokens ?? null,
      completionTokens: res.usage?.completion_tokens ?? null,
      totalTokens: res.usage?.total_tokens ?? null,
      latencyMs: latency,
      success: true,
      error: null
    })
    return parsed
  } catch (e: any) {
    await auditLLM(query, {
      interviewId: interviewId || null,
      phase: 'parse',
      model: MODEL,
      latencyMs: null,
      success: false,
      error: String(e?.message || e)
    })
    return null
  }
}

r.post('/start-interview', async (c) => {
  const body = await c.req.json()
  const payload = StartPayload.parse(body)

  let resumeSummary = payload.resumeSummary || null

  // 若仅传了 PDF 路径，自动 下载 → 提取文本 → LLM 摘要
  if (!resumeSummary && payload.resumeFileUrl) {
    try {
      const key = payload.resumeFileUrl
      const buf = await downloadFromStorage(STORAGE_BUCKET, key)
      const text = await pdfArrayBufferToText(buf)
      // 你之前传 undefined，这里依然允许；如需把审计与本次面试绑定，可在插入 interview 之后再调用并传 interviewId
      const parsed = await parseResumeTextToSummary(text, undefined)
      if (parsed) {
        resumeSummary = parsed
      }
    } catch (e: any) {
      console.warn('[start-interview] auto-parse resume failed:', e?.message || e)
    }
  }

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
      resumeSummary ? JSON.stringify(resumeSummary) : null
    ]
  )
  const interviewId = ir[0].id

  const planningPromptPath = resolvePrompt('planning.md')
  const planningPrompt = await fs.readFile(planningPromptPath, 'utf-8')
  const sys =
    `${planningPrompt}\n请严格输出 JSON。上下文：\n` +
    `JD:\n${payload.jdText || ''}\n` +
    `简历要点:\n${JSON.stringify(resumeSummary || {})}`

  // 生成函数 + 重试一次，且强约束 JSON 数组
  async function generateOnce() {
    const t0 = Date.now()
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: '请生成问题清单（5-8题），每项包含 order_no, topic, text, intent, rubric_ref。只输出一个 JSON 数组，不要任何解释。' }
      ],
      temperature: 0.3
    })
    const latency = Date.now() - t0

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

    let list: any[] = []
    try {
      const content = res.choices[0]?.message?.content || '[]'
      list = JSON.parse(content)
    } catch {
      list = []
    }
    return list
  }

  let list: any[] = []
  try {
    list = await generateOnce()
    if (!Array.isArray(list) || list.length === 0) {
      // 重试一次（避免偶发解析失败）
      list = await generateOnce()
    }
  } catch (e: any) {
    await auditLLM(query, {
      interviewId,
      phase: 'planning',
      model: MODEL,
      latencyMs: null,
      success: false,
      error: String(e?.message || e)
    })
    list = []
  }

  // 兜底：在 topic 前加标记，便于前端识别
  if (!Array.isArray(list) || list.length === 0) {
    list = Array.from({ length: 5 }).map((_, i) => ({
      order_no: i + 1,
      topic: i === 0 ? '[兜底] 自我介绍' : '[兜底] 经历深挖',
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