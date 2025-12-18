import { Hono } from 'hono'
import { client, MODEL } from '../lib/llm.js'
import { query } from '../lib/db.js'
import { auditLLM } from '../lib/util.js'

const r = new Hono()

// 简历解析（纯文本/markdown 摘要），用于问题生成上下文
r.post('/parse-resume', async (c) => {
  const { text, interviewId } = await c.req.json()
  if (!text || typeof text !== 'string') return c.json({ ok: false, error: '缺少简历文本' }, 400)

  const sys = '你是资深招聘顾问，请将简历要点结构化提炼，输出 JSON：{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}'
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

    if (interviewId) {
      await query(
        `update app.interviews set resume_summary=$1 where id=$2`,
        [JSON.stringify(parsed), interviewId]
      )
    }

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

    return c.json({ ok: true, data: parsed })
  } catch (e: any) {
    await auditLLM(query, {
      interviewId: interviewId || null,
      phase: 'parse',
      model: MODEL,
      latencyMs: Date.now() - t0,
      success: false,
      error: String(e?.message || e)
    })
    return c.json({ ok: false, error: '解析失败' }, 500)
  }
})

export default r