// api/src/server/lib/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY // 新增：服务端密钥
const ANON_KEY = process.env.SUPABASE_ANON_KEY
export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'resumes'

// 基本检查
if (!SUPABASE_URL) {
  throw new Error('Missing env: SUPABASE_URL')
}
if (!SERVICE_KEY && !ANON_KEY) {
  const hints = [
    `SUPABASE_URL=${String(SUPABASE_URL)}`,
    `SUPABASE_SERVICE_KEY exists=${!!SERVICE_KEY}`,
    `SUPABASE_ANON_KEY exists=${!!ANON_KEY}`,
    '请配置至少一个 Key，推荐在服务端使用 SUPABASE_SERVICE_KEY。'
  ].join('\n  ')
  throw new Error(`Missing Supabase keys\n  ${hints}`)
}

// 优先使用 service key（服务端拥有绕 RLS 权限）
const KEY = SERVICE_KEY || ANON_KEY!

// 可选：在日志中仅打印是否存在，不打印真实值
if (process.env.NODE_ENV !== 'production') {
  console.log('[supabase] useServiceKey=', !!SERVICE_KEY, 'bucket=', STORAGE_BUCKET)
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false },
  // 可选：标识应用来源
  global: { headers: { 'x-application-name': 'interview-assistant' } }
})