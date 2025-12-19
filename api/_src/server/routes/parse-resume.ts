console.log('[parse-resume] file loaded')
import { Hono } from 'hono'
import { client, MODEL } from '../lib/llm.js'
import { query } from '../lib/db.js'
import { auditLLM } from '../lib/util.js'

const r = new Hono()

// 简历解析（纯文本/markdown 摘要），用于问题生成上下文
r.post('/parse-resume', async (c) => {
    console.log('[parse-resume] route entered')
  const { text, interviewId } = await c.req.json()
  if (!text || typeof text !== 'string') return c.json({ ok: false, error: '缺少简历文本' }, 400)

  // 输入规模记录，帮助判断是否因文本过长导致模型处理慢
  const size = text.length
  console.log('[parse-resume] start', { size, hasInterviewId: !!interviewId })

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
    console.log('[parse-resume] llm ok', {
      latency,
      promptTokens: res.usage?.prompt_tokens ?? null,
      completionTokens: res.usage?.completion_tokens ?? null,
      totalTokens: res.usage?.total_tokens ?? null
    })

    let parsed: any = {}
    try {
      const content = res.choices[0]?.message?.content || '{}'
      parsed = JSON.parse(content)
    } catch (e: any) {
      // 如果模型返回的不是合法 JSON，记录并给出更明确的错误
      console.warn('[parse-resume] JSON parse fail', { msg: e?.message || String(e) })
      return c.json({ ok: false, error: '模型返回的内容不是有效 JSON' }, 502)
    }

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
    const latency = Date.now() - t0
    const name = e?.name || ''
    const msg = e?.message || String(e)

    // 区分常见错误类型，便于快速判断是否网络导致
    // - AbortError：我们自设的上游超时（如 8s）被触发，多为网络/连通性问题或上游响应过慢
    // - fetch/NetworkError：链路异常
    // - 429/5xx：通常在 llm.ts 的 fetch 日志中能看到 status；这里兜底为通用错误
    console.error('[parse-resume] llm fail', { latency, name, msg })

    await auditLLM(query, {
      interviewId: interviewId || null,
      phase: 'parse',
      model: MODEL,
      latencyMs: latency,
      success: false,
      error: `${name}: ${msg}`
    })

    // 根据错误类型返回更具体的提示，便于前端展示与排障
    if (name === 'AbortError') {
      return c.json({ ok: false, error: '上游模型调用超时（可能为网络/地域链路问题）' }, 504)
    }
    if (/network|fetch|Failed to fetch/i.test(msg)) {
      return c.json({ ok: false, error: '网络异常，无法连接模型服务' }, 502)
    }

    return c.json({ ok: false, error: '解析失败' }, 500)
  }
})

export default r