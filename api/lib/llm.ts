// api/lib/llm.ts
import OpenAI from 'openai';

const PROVIDER = process.env.LLM_PROVIDER || 'openai'; // 'openai' | 'deepseek'
const MODEL = process.env.MODEL_NAME || (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || (PROVIDER === 'deepseek' ? '' : 'text-embedding-3-small');

let apiKey = '';
let baseURL: string | undefined = undefined;

if (PROVIDER === 'openai') {
  apiKey = process.env.OPENAI_API_KEY || '';
  baseURL = process.env.OPENAI_BASE_URL || undefined; // 可选代理
} else if (PROVIDER === 'deepseek') {
  apiKey = process.env.DEEPSEEK_API_KEY || '';
  baseURL = 'https://api.deepseek.com';
}

if (!apiKey) {
  throw new Error(`Missing API key for provider=${PROVIDER}`);
}

const client = new OpenAI({ apiKey, baseURL });

export { client, MODEL, EMBEDDING_MODEL, PROVIDER };