import { Hono } from 'hono'
import { query } from '../lib/db.ts'
import { client, MODEL } from '../lib/llm.ts'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const r = new Hono()

function resolvePrompt(...segments: string[]) {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  return path.join(__dirname, '..', 'lib', 'prompts', ...segments)
}

r.get('/next-question', async (c) => {
  const interviewId = c.req.query('interviewId')
  const orderNoStr = c.req.query('orderNo') || '1'
  const orderNo = parseInt(orderNoStr, 10)

  if (!interviewId) return c.json({ ok: false, error: '缺少 interviewId' }, 400)

  const { rows: qs } = await query<any>(
    `select * from app.questions where interview_id=$1 and order_no=$2`,
    [interviewId, orderNo]
  )
  if (qs.length === 0) return c.json({ ok: false, error: '题目不存在' }, 404)

  const q = qs[0]
  if (!q.followup_pool) {
    const promptPath = resolvePrompt('questioning.md')
    const prompt = await fs.readFile(promptPath, 'utf-8')

    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `当前题目：${q.text}\n请给出追问候选。` }
      ],
      temperature: 0.4
    })

    try {
      const j = JSON.parse(res.choices[0]?.message?.content || '{}')
      await query(
        `update app.questions set followup_pool=$1 where id=$2`,
        [JSON.stringify(j.followups || []), q.id]
      )
      q.followup_pool = j.followups || []
    } catch {
      q.followup_pool = []
    }
  }

  return c.json({
    ok: true,
    data: {
      question: {
        id: q.id,
        orderNo: q.order_no,
        topic: q.topic,
        text: q.text,
        followups: q.followup_pool || []
      }
    }
  })
})

export default r