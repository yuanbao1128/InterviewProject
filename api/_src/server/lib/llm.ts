// api/src/server/lib/llm.ts
import OpenAI from 'openai'

function sanitizeBase(raw?: string | null) {
  const v = (raw || '').trim()
  if (!v) return ''
  return v.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

const PROVIDER_EXPLICIT = (process.env.LLM_PROVIDER || '').toLowerCase() as 'openai' | 'deepseek' | ''
const BASE_RAW = sanitizeBase(process.env.OPENAI_BASE_URL)
const API_KEY = process.env.OPENAI_API_KEY || ''

let PROVIDER: 'openai' | 'deepseek' =
  (PROVIDER_EXPLICIT as any) ||
  (BASE_RAW ? (/deepseek/i.test(BASE_RAW) ? 'deepseek' : /openai/i.test(BASE_RAW) ? 'openai' : 'openai') : 'openai')

const DEFAULTS = { openai: 'https://api.openai.com', deepseek: 'https://api.deepseek.com' } as const
const baseURL = (BASE_RAW || DEFAULTS[PROVIDER]).replace(/\/+$/, '')

if (!API_KEY) throw new Error(`Missing API key for provider=${PROVIDER}. 缺少 OPENAI_API_KEY`)

// 提高默认超时到 60s（可被 env 覆盖）
const UPSTREAM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000)
// 可保留 2 次，也可设 3 次
const UPSTREAM_RETRIES = Number(process.env.LLM_RETRIES || 2)

console.log('[llm] init', {
  provider: PROVIDER,
  baseURL: baseURL.replace(/^(https?:\/\/)/, '$1***.'),
  timeoutMs: UPSTREAM_TIMEOUT_MS
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
        const retriable = name === 'AbortError' || /network|fetch|timeout/i.test(msg)
        console.warn('[llm.fetch.error]', { attempt, name, msg })
        lastErr = e
        if (!retriable || attempt === maxRetries) throw e
        // 加长退避时间
        await new Promise(r => setTimeout(r, 400 * attempt))
      }
    }
    throw lastErr
  }
}

const timedFetch = createTimedFetch(UPSTREAM_TIMEOUT_MS, UPSTREAM_RETRIES)

const client = new OpenAI({ apiKey: API_KEY, baseURL, fetch: timedFetch as any })

const MODEL = process.env.MODEL_NAME || (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini')
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || (PROVIDER === 'deepseek' ? '' : 'text-embedding-3-small')

export { client, MODEL, EMBEDDING_MODEL, PROVIDER }

// 流式总超时工具保留
export async function* withTimeoutStream<T>(iterable: AsyncIterable<T>, ms: number): AsyncGenerator<T, void, unknown> {
  const iterator = iterable[Symbol.asyncIterator]()
  try {
    while (true) {
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`stream timeout after ${ms}ms`)), ms))
      ])
      if ((result as any).done) break
      yield (result as any).value
    }
  } finally {
    try { await (iterator as any).return?.() } catch {}
  }
}