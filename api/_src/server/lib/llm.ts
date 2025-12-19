// api/src/server/lib/llm.ts
import OpenAI from 'openai'

function sanitizeBase(raw?: string | null) {
  const v = (raw || '').trim()
  if (!v) return ''
  // 去掉结尾的斜杠与 /v1
  return v.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

// 统一变量：无论是 DeepSeek 还是 OpenAI，都用这组变量
const PROVIDER_EXPLICIT = (process.env.LLM_PROVIDER || '').toLowerCase() as 'openai' | 'deepseek' | ''
const BASE_RAW = sanitizeBase(process.env.OPENAI_BASE_URL) // 统一：用 OPENAI_BASE_URL 承载 base
const API_KEY = process.env.OPENAI_API_KEY || ''           // 统一：用 OPENAI_API_KEY 承载 key

// 推断 provider
let PROVIDER: 'openai' | 'deepseek' =
  (PROVIDER_EXPLICIT as any) ||
  (BASE_RAW
    ? (/deepseek/i.test(BASE_RAW) ? 'deepseek' : /openai/i.test(BASE_RAW) ? 'openai' : 'openai')
    : 'openai')

// 默认 base
const DEFAULTS = {
  openai: 'https://api.openai.com',
  deepseek: 'https://api.deepseek.com'
} as const

const baseURL = (BASE_RAW || DEFAULTS[PROVIDER]).replace(/\/+$/, '')

if (!API_KEY) {
  const hint = PROVIDER === 'deepseek'
    ? '缺少 OPENAI_API_KEY（此变量统一承载 DeepSeek 或 OpenAI 的 Key）'
    : '缺少 OPENAI_API_KEY'
  throw new Error(`Missing API key for provider=${PROVIDER}. ${hint}`)
}

// 上游调用可配置超时与重试（默认 8s、重试 2 次）
const UPSTREAM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000)
const UPSTREAM_RETRIES = Number(process.env.LLM_RETRIES || 2)

console.log('[llm] init', {
  provider: PROVIDER,
  baseURL: baseURL.replace(/^(https?:\/\/)/, '$1***.'),
  timeoutMs: UPSTREAM_TIMEOUT_MS
})

// 自定义带超时与重试的 fetch；OpenAI SDK 支持传入自定义 fetch
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
        await new Promise(r => setTimeout(r, 200 * attempt))
      }
    }
    throw lastErr
  }
}

const timedFetch = createTimedFetch(UPSTREAM_TIMEOUT_MS, UPSTREAM_RETRIES)

// OpenAI SDK 接受 baseURL（无需含 /v1）；SDK 会拼接 /v1
const client = new OpenAI({ apiKey: API_KEY, baseURL, fetch: timedFetch as any })

// MODEL 与 EMBEDDING_MODEL 依旧受 LLM_PROVIDER 影响，但不再依赖其他变量命名
const MODEL =
  process.env.MODEL_NAME ||
  (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini')
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ||
  (PROVIDER === 'deepseek' ? '' : 'text-embedding-3-small')

export { client, MODEL, EMBEDDING_MODEL, PROVIDER }