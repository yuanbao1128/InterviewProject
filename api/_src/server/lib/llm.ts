// api/_src/server/lib/llm.ts 仅增加 ali 分支（可选）
import OpenAI from 'openai'

function sanitizeBase(raw?: string | null) {
  const v = (raw || '').trim()
  if (!v) return ''
  return v.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

const PROVIDER_EXPLICIT = (process.env.LLM_PROVIDER || '').toLowerCase() as 'openai' | 'deepseek' | 'ali' | ''
const BASE_RAW = sanitizeBase(process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.ALI_BASE_URL)
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ALI_API_KEY || ''

let PROVIDER: 'openai' | 'deepseek' | 'ali' =
  (PROVIDER_EXPLICIT as any) ||
  (BASE_RAW ? (/deepseek/i.test(BASE_RAW) ? 'deepseek' : /openai|api\.openai/i.test(BASE_RAW) ? 'openai' : /dashscope|aliyun|ali/i.test(BASE_RAW) ? 'ali' : 'openai') : 'openai')

const DEFAULTS = { openai: 'https://api.openai.com', deepseek: 'https://api.deepseek.com', ali: 'https://dashscope.aliyuncs.com/compatible-mode/v1' } as const
const baseURL = (BASE_RAW || DEFAULTS[PROVIDER]).replace(/\/+$/, '')

if (!API_KEY) {
  throw new Error(`Missing API key. 请配置 OPENAI_API_KEY 或 DEEPSEEK_API_KEY 或 ALI_API_KEY`)
}

const UPSTREAM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000)
const UPSTREAM_RETRIES = Number(process.env.LLM_RETRIES || 2)
export const HARD_TIMEOUT_SUGGESTED = Number(process.env.LLM_HARD_TIMEOUT_MS || 90000)

console.log('[llm] init', {
  provider: PROVIDER,
  baseURL: baseURL.replace(/^(https?:\/\/[^/]+).*/, '$1'),
  timeoutMs: UPSTREAM_TIMEOUT_MS,
  retries: UPSTREAM_RETRIES
})

function createTimedFetch(timeoutMs: number, maxRetries: number) {
  return async (url: string, init?: RequestInit) => {
    let lastErr: any
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      const started = Date.now()
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal })
        const rt = Date.now() - started
        try {
          const host = new URL(url).host
          console.log('[llm.fetch.ok]', { host, status: res.status, rt, attempt })
        } catch {}
        clearTimeout(timer)
        return res
      } catch (e: any) {
        clearTimeout(timer)
        const msg = e?.message || String(e)
        const name = e?.name || ''
        const retriable = name === 'AbortError' || /network|fetch|timeout|socket|ECONNRESET|ETIMEDOUT/i.test(msg)
        console.warn('[llm.fetch.error]', { attempt, name, msg })
        lastErr = e
        if (!retriable || attempt === maxRetries) throw e
        await new Promise(r => setTimeout(r, 400 * attempt))
      }
    }
    throw lastErr
  }
}

const timedFetch = createTimedFetch(UPSTREAM_TIMEOUT_MS, UPSTREAM_RETRIES)
const client = new OpenAI({ apiKey: API_KEY, baseURL, fetch: timedFetch as any })

const MODEL = process.env.MODEL_NAME || (
  PROVIDER === 'deepseek' ? 'deepseek-chat' :
  PROVIDER === 'ali' ? 'qwen-plus' :
  'gpt-4o-mini'
)
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || (PROVIDER === 'deepseek' ? '' : 'text-embedding-3-small')

export { client, MODEL, EMBEDDING_MODEL, PROVIDER, baseURL, API_KEY }

export async function restChatCompletion(opts: {
  model: string
  system: string
  user: string
  temperature?: number
  signal?: AbortSignal
}): Promise<string> {
  const url = `${baseURL}/v1/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`
  }
  if (process.env.DS_ORG_ID) headers['X-Organization'] = process.env.DS_ORG_ID
  if (process.env.DS_PROJECT_ID) headers['X-Project'] = process.env.DS_PROJECT_ID

  const body = {
    model: opts.model,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user }
    ]
  }

  const res = await timedFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal as any
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 400)}`)
  }

  const json: any = await res.json()
  const content = json?.choices?.[0]?.message?.content ?? ''
  return String(content || '')
}