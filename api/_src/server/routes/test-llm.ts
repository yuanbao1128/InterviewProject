// _src/server/routes/test-llm.ts
import { Hono } from 'hono'

const r = new Hono()

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal as any })
    return res
  } finally {
    clearTimeout(t)
  }
}

async function probe(base: string, model: string, key?: string, extraHeaders?: Record<string,string>) {
  const url = `${base.replace(/\/+$/,'')}/v1/chat/completions`
  const headers: Record<string,string> = { 'Content-Type': 'application/json', ...(extraHeaders || {}) }
  if (key) headers['Authorization'] = `Bearer ${key}`

  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'ping' }
    ]
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    } as any, Number(process.env.TEST_TIMEOUT_MS || 8000))

    const text = await res.text()
    return { ok: res.ok, status: res.status, snippet: text.slice(0, 240), url }
  } catch (e: any) {
    return { ok: false, error: String(e?.name || '') + ': ' + String(e?.message || e), url }
  }
}

r.get('/test-llm', async (c) => {
  const dsBase = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const dsModel = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const dsKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY
  const extra: Record<string,string> = {}
  if (process.env.DS_ORG_ID) extra['X-Organization'] = process.env.DS_ORG_ID!
  if (process.env.DS_PROJECT_ID) extra['X-Project'] = process.env.DS_PROJECT_ID!

  const oiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com'
  const oiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const oiKey = process.env.OPENAI_API_KEY

  const [deepseek, openai] = await Promise.all([
    probe(dsBase, dsModel, dsKey, extra),
    probe(oiBase, oiModel, oiKey)
  ])

  return c.json({
    env: { region: process.env.VERCEL_REGION, node: process.versions.node },
    deepseek,
    openai
  })
})

export default r