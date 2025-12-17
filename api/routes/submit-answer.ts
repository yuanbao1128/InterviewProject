import { Hono } from 'hono'
import { query } from '../lib/db.js'
import { client, MODEL } from '../lib/llm.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
    `insert into app.answers (interview_id, question_id, turn_no, content)
     values ($1,$2,$3,$4)`,
    [interviewId, questionId, turnNo, content]
  )

  const scoringPromptPath = resolvePrompt('scoring.md')
  const scoringPrompt = await fs.readFile(scoringPromptPath, 'utf-8')

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: scoringPrompt },
      { role: 'user', content: `题目：${questionId}\n候选人回答：${content}` }
    ],
    temperature: 0.2
  })

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

  return c.json({ ok: true })
})

export default r