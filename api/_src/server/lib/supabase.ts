// api/src/server/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'resumes'

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  const hints = [
    `SUPABASE_URL=${String(SUPABASE_URL)}`,
    `SUPABASE_ANON_KEY exists=${!!SUPABASE_ANON_KEY}`,
    '请确认：',
    '1) 本地开发使用 tsx --env-file=.env.local（或 .env），env 文件位于 api 目录',
    '2) [...all].ts 顶部已调用 dotenv.config（或完全依赖 --env-file）',
    '3) 键名无拼写错误，无不可见空格'
  ].join('\n  ')
  throw new Error(`Missing Supabase env\n  ${hints}`)
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
})