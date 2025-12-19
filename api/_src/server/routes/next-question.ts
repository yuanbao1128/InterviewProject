import { Hono } from 'hono'
import { query } from '../lib/db.js'
import { client, MODEL } from '../lib/llm.js'
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

r.get('/next-question', async (c) => {
  const interviewId = c.req.query('interviewId')
  if (!interviewId) return c.json({ ok: false, error: '缺少 interviewId' }, 400)

  const { rows: ist } = await query<any>(
    `select progress_state from app.interviews where id=$1`,
    [interviewId]
  )
  if (ist.length === 0) return c.json({ ok: false, error: '会话不存在' }, 404)
  const ps = ist[0].progress_state || {}
  const orderNo = parseInt(ps.current || '1', 10)
  const total = parseInt(ps.total || '1', 10)

  const { rows: qs } = await query<any>(
    `select * from app.questions where interview_id=$1 and order_no=$2`,
    [interviewId, orderNo]
  )
  if (qs.length === 0) return c.json({ ok: false, error: '题目不存在' }, 404)

  const q = qs[0]
  if (!q.followup_pool) {
    const promptPath = resolvePrompt('questioning.md')
    const prompt = await fs.readFile(promptPath, 'utf-8')

    const t0 = Date.now()
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `当前题目：${q.text}\n请只返回 JSON：{"followups": string[]}，不要任何解释、前后缀。` }
        ],
        temperature: 0.4
      })
      const latency = Date.now() - t0
      let followups: string[] = []
      try {
        const j = JSON.parse(res.choices[0]?.message?.content || '{}')
        followups = Array.isArray(j.followups) ? j.followups : []
      } catch { followups = [] }

      await query(
        `update app.questions set followup_pool=$1 where id=$2`,
        [JSON.stringify(followups), q.id]
      )

      await auditLLM(query, {
        interviewId,
        phase: 'question',
        model: MODEL,
        promptTokens: res.usage?.prompt_tokens ?? null,
        completionTokens: res.usage?.completion_tokens ?? null,
        totalTokens: res.usage?.total_tokens ?? null,
        latencyMs: latency,
        success: true,
        error: null
      })

      q.followup_pool = followups
    } catch (e: any) {
      await auditLLM(query, {
        interviewId,
        phase: 'question',
        model: MODEL,
        latencyMs: Date.now() - t0,
        success: false,
        error: String(e?.message || e)
      })
      q.followup_pool = []
    }
  }

  const isFallback = typeof q.topic === 'string' && q.topic.startsWith('[兜底]')

  return c.json({
    ok: true,
    data: {
      question: {
        id: q.id,
        orderNo: q.order_no,
        topic: q.topic,
        text: q.text,
        followups: q.followup_pool || [],
        isFallback
      },
      total
    }
  })
})

export default r