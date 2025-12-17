// api/src/server/lib/llm.ts
import OpenAI from 'openai'

const PROVIDER = process.env.LLM_PROVIDER || 'openai' // 'openai' | 'deepseek'
const MODEL =
  process.env.MODEL_NAME ||
  (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini')
const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ||
  (PROVIDER === 'deepseek' ? '' : 'text-embedding-3-small')

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

if (!apiKey) {
  throw new Error(`Missing API key for provider=${PROVIDER}`)
}

const client = new OpenAI({ apiKey, baseURL })

export { client, MODEL, EMBEDDING_MODEL, PROVIDER }