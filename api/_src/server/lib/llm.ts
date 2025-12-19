// api/src/server/lib/llm.ts
import OpenAI from 'openai'

const PROVIDER = process.env.LLM_PROVIDER || 'openai' // 'openai' | 'deepseek'
const MODEL =
  process.env.MODEL_NAME ||
  (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini')
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ||
  (PROVIDER === 'deepseek' ? '' : 'text-embedding-3-small')

// 上游调用可配置超时与重试（默认 8s、重试 2 次）
const UPSTREAM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000)
const UPSTREAM_RETRIES = Number(process.env.LLM_RETRIES || 2)

let apiKey = ''
let baseURL: string | undefined

if (PROVIDER === 'openai') {
  apiKey = process.env.OPENAI_API_KEY || ''
  baseURL = process.env.OPENAI_BASE_URL || undefined
} else if (PROVIDER === 'deepseek') {
  apiKey = process.env.DEEPSEEK_API_KEY || ''
  baseURL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
} else {
  throw new Error(`Unknown LLM provider: ${PROVIDER}`)
}

console.log('[llm] init', { provider: PROVIDER, baseURL, timeoutMs: UPSTREAM_TIMEOUT_MS })

if (!apiKey) {
  // 给出更友好的报错信息，便于 Vercel 日志定位
  const hint = PROVIDER === 'deepseek'
    ? '缺少 DEEPSEEK_API_KEY（可选：DEEPSEEK_BASE_URL）'
    : '缺少 OPENAI_API_KEY（可选：OPENAI_BASE_URL）'
  throw new Error(`Missing API key for provider=${PROVIDER}. ${hint}`)
}

// 自定义带超时与重试的 fetch；OpenAI SDK 支持传入自定义 fetch
function createTimedFetch(timeoutMs: number, maxRetries: number) {
    console.log('[llm.fetch] called')
  return async (url: string, init?: RequestInit) => {
    let lastErr: any
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      const started = Date.now()
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal })
        const rt = Date.now() - started
        // 记录上游响应概览（不打印敏感头）
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
        // 线性退避
        await new Promise(r => setTimeout(r, 200 * attempt))
      }
    }
    throw lastErr
  }
}

const timedFetch = createTimedFetch(UPSTREAM_TIMEOUT_MS, UPSTREAM_RETRIES)

const client = new OpenAI({ apiKey, baseURL, fetch: timedFetch as any })

export { client, MODEL, EMBEDDING_MODEL, PROVIDER }