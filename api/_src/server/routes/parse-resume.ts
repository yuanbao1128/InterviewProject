console.log('[parse-resume] file loaded')

import { Hono } from 'hono'
import { client, MODEL } from '../lib/llm.js'
import { query } from '../lib/db.js'
import { auditLLM } from '../lib/util.js'

const r = new Hono()

// 推断与规范化配置
function getProviderConfig() {
  const explicit = (process.env.PROVIDER || '').toLowerCase() as 'deepseek' | 'openai' | ''
  const base = process.env.OPENAI_BASE_URL?.trim() || '' // 约定用这个变量放 base，无论 DeepSeek 还是 OpenAI
  const key = process.env.OPENAI_API_KEY || ''           // 约定用这个变量放 key，无论 DeepSeek 还是 OpenAI

  // 自动推断
  let provider: 'deepseek' | 'openai' = explicit || 'openai'
  if (!explicit && base) {
    if (/deepseek/i.test(base)) provider = 'deepseek'
    if (/openai/i.test(base)) provider = 'openai'
  }

  // 默认 base
  const defaults = {
    openai: 'https://api.openai.com',
    deepseek: 'https://api.deepseek.com'
  } as const
  const resolvedBase = base || defaults[provider]

  return { provider, baseURL: resolvedBase.replace(/\/+$/, ''), apiKey: key }
}

// 轻量超时（探针用）
function withTimeout<T>(p: Promise<T>, ms: number) {
  let to: any
  return Promise.race<T>([
    p,
    new Promise<T>((_, rej) => {
      to = setTimeout(() => {
        const err = new Error('Probe timeout')
        ;(err as any).name = 'AbortError'
        rej(err)
      }, ms)
    })
  ]).finally(() => clearTimeout(to))
}

// 探针：GET /v1/models
async function probe(label: string, base: string, key?: string, timeoutMs = 2500) {
  const url = base.replace(/\/+$/, '') + '/v1/models'
  const t0 = Date.now()
  try {
    const res = await withTimeout(
      fetch(url, {
        method: 'GET',
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        cache: 'no-store'
      }),
      timeoutMs
    )
    const rt = Date.now() - t0
    console.log('[probe]', label, { url, status: res.status, rt })
    return { ok: true as const, status: res.status, rt }
  } catch (e: any) {
    const rt = Date.now() - t0
    console.log('[probe]', label, 'error', { url, rt, name: e?.name || 'Error', msg: e?.message || String(e) })
    return { ok: false as const, rt, name: e?.name || 'Error', msg: e?.message || String(e) }
  }
}

r.post('/parse-resume', async (c) => {
  console.log('[parse-resume] route entered')

  const { text, interviewId } = await c.req.json()
  if (!text || typeof text !== 'string') return c.json({ ok: false, error: '缺少简历文本' }, 400)

  const size = text.length
  console.log('[parse-resume] start', { size, hasInterviewId: !!interviewId })

  // 读取与推断 provider/base/key
  const { provider, baseURL, apiKey } = getProviderConfig()
  console.log('[parse-resume] config', { provider, baseURL: baseURL.replace(/^(https?:\/\/)/, '$1***.') })

  // 连通性探针：当前配置
  try {
    const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 2500)
    await probe(`${provider}:base`, baseURL, apiKey, PROBE_TIMEOUT_MS)

    // 对照探针（可选）：另一家官方端点，用于分辨是“上游网关问题”还是“区域链路问题”
    if (process.env.PROBE_COMPARE === '1') {
      if (provider === 'deepseek') {
        await probe('openai:official', 'https://api.openai.com', process.env.OPENAI_OFFICIAL_KEY || apiKey, PROBE_TIMEOUT_MS)
      } else {
        await probe('deepseek:official', 'https://api.deepseek.com', process.env.DEEPSEEK_API_KEY || apiKey, PROBE_TIMEOUT_MS)
      }
    }
  } catch {
    // 探针异常不影响主流程
  }

  const sys =
    '你是资深招聘顾问，请将简历要点结构化提炼，输出 JSON：' +
    '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}'

  const t0 = Date.now()
  try {
    // 维持你现有的 client 和 MODEL（llm.ts 内可根据环境配置不同 provider 与 base）
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

    console.error('[parse-resume] llm fail', { latency, name, msg })

    await auditLLM(query, {
      interviewId: interviewId || null,
      phase: 'parse',
      model: MODEL,
      latencyMs: latency,
      success: false,
      error: `${name}: ${msg}`
    })

    // 错误映射
    if (name === 'AbortError') {
      return c.json({ ok: false, error: '上游模型调用超时（可能为网络/地域链路问题）' }, 504)
    }
    if (/network|fetch|Failed to fetch|Connection\s?error|ECONN|ENOTFOUND|TLS|certificate/i.test(msg)) {
      return c.json({ ok: false, error: '网络异常，无法连接模型服务' }, 502)
    }
    if (/429/.test(msg)) {
      return c.json({ ok: false, error: '上游限流，请稍后重试' }, 429)
    }

    return c.json({ ok: false, error: '解析失败' }, 500)
  }
})

export default r