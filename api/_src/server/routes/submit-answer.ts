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

r.post('/submit-answer', async (c) => {
  const { interviewId, questionId, turnNo, content } = await c.req.json()
  if (!interviewId || !questionId || !turnNo || !content) {
    return c.json({ ok: false, error: '缺少字段' }, 400)
  }

  await query(
    `insert into app.answers (interview_id, question_id, turn_no, content, answer_type)
     values ($1,$2,$3,$4,'main')`,
    [interviewId, questionId, turnNo, content]
  )

  const scoringPromptPath = resolvePrompt('scoring.md')
  const scoringPrompt = await fs.readFile(scoringPromptPath, 'utf-8')

  const t0 = Date.now()
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: scoringPrompt },
        { role: 'user', content: `题目ID：${questionId}\n候选人回答：${content}` }
      ],
      temperature: 0.2
    })

    const latency = Date.now() - t0
    let score: any = {}
    try {
      score = JSON.parse(res.choices[0]?.message?.content || '{}')
    } catch {
      score = {}
    }

    await query(
      `insert into app.scores (interview_id, question_id, overall, dimensions, evidence, suggestions)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        interviewId,
        questionId,
        score.overall ?? null,
        JSON.stringify(score.dimensions || {}),
        JSON.stringify(score.evidence || []),
        JSON.stringify(score.suggestions || [])
      ]
    )

    await auditLLM(query, {
      interviewId,
      phase: 'score',
      model: MODEL,
      promptTokens: res.usage?.prompt_tokens ?? null,
      completionTokens: res.usage?.completion_tokens ?? null,
      totalTokens: res.usage?.total_tokens ?? null,
      latencyMs: latency,
      success: true,
      error: null
    })
  } catch (e: any) {
    await auditLLM(query, {
      interviewId,
      phase: 'score',
      model: MODEL,
      latencyMs: Date.now() - t0,
      success: false,
      error: String(e?.message || e)
    })
    // 评分失败不阻塞流程
  }

  // 进入下一题（简化：每题一轮）
  const { rows: psr } = await query<any>(
    `select progress_state from app.interviews where id=$1`,
    [interviewId]
  )
  const ps = psr[0]?.progress_state || {}
  const current = (ps.current || 1) + 1
  const total = ps.total || 1
  const next = current > total ? total : current

  await query(
    `update app.interviews
        set progress_state = jsonb_set(coalesce(progress_state,'{}'::jsonb), '{current}', to_jsonb($1::int))
      where id=$2`,
    [next, interviewId]
  )

  return c.json({ ok: true })
})

export default r