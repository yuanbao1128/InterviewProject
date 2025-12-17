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

r.get('/report', async (c) => {
  const interviewId = c.req.query('interviewId')
  if (!interviewId) return c.json({ ok: false, error: '缺少 interviewId' }, 400)

  const { rows: qs } = await query<any>(
    `select q.id, q.order_no, q.text
       from app.questions q
      where interview_id = $1
      order by order_no asc`,
    [interviewId]
  )

  const { rows: as } = await query<any>(
    `select question_id,
            string_agg(content, '\n---\n' order by created_at) as answer
       from app.answers
      where interview_id = $1
      group by question_id`,
    [interviewId]
  )

  const map = new Map<string, string>()
  as.forEach((a) => map.set(a.question_id, a.answer))

  const planning = qs.map((q: any) => ({ question: q.text, answer: map.get(q.id) || '' }))

  const promptPath = resolvePrompt('report.md')
  const prompt = await fs.readFile(promptPath, 'utf-8')

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(planning) }
    ],
    temperature: 0.2
  })

  let report: any = {}
  try {
    report = JSON.parse(res.choices[0]?.message?.content || '{}')
  } catch {
    report = {}
  }

  await query(
    `insert into app.reports (interview_id, overall, summary, dimensions, items)
     values ($1,$2,$3,$4,$5)
     on conflict (interview_id)
       do update set
         overall = excluded.overall,
         summary = excluded.summary,
         dimensions = excluded.dimensions,
         items = excluded.items`,
    [
      interviewId,
      report.overall ?? null,
      report.summary || '',
      JSON.stringify(report.dimensions || {}),
      JSON.stringify(report.items || [])
    ]
  )

  return c.json({ ok: true, data: report })
})

export default r