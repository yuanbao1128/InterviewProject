// api/[...all].ts

// ① 本地环境变量加载（仅本地生效；Vercel 线上由平台注入）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envLocal = path.join(__dirname, '.env.local')
const envFile = fs.existsSync(envLocal) ? envLocal : path.join(__dirname, '.env')
if (process.env.VERCEL !== '1') {
  dotenv.config({ path: envFile })
}

// ② 应用代码
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'

// 子路由（node16/nodenext 必须带 .js 后缀）
import upload from './_src/server/routes/upload.js'
import parseResume from './_src/server/routes/parse-resume.js'
import startInterview from './_src/server/routes/start-interview.js'
import nextQuestion from './_src/server/routes/next-question.js'
import submitAnswer from './_src/server/routes/submit-answer.js'
import finish from './_src/server/routes/finish.js'
import report from './_src/server/routes/report.js'
import metrics from './_src/server/routes/metrics.js'

const app = new Hono()

// 全局错误兜底（防止 500 时没有日志）
app.onError((err, c) => {
  console.error('[app.onError]', {
    method: c.req.method,
    url: c.req.url,
    message: err?.message,
    stack: err?.stack
  })
  return c.json({ ok: false, error: err?.message || 'Internal Server Error' }, 500)
})

// 请求进入日志（便于排查 content-type/大小）
app.use('*', async (c, next) => {
  const ct = c.req.header('content-type') || ''
  const clen = c.req.header('content-length') || ''
  console.log('[req]', {
    method: c.req.method,
    url: c.req.url,
    contentType: ct,
    contentLength: clen
  })
  return next()
})

// CORS
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
)

// 美化 JSON（开发友好）
app.use('*', prettyJSON())

// 统一挂到 /api
app.route('/api', upload)
app.route('/api', parseResume)
app.route('/api', startInterview)
app.route('/api', nextQuestion)
app.route('/api', submitAnswer)
app.route('/api', finish)
app.route('/api', report)
app.route('/api', metrics)

// 导出给 Vercel 适配器
export const GET = app.fetch
export const POST = app.fetch
export const PUT = app.fetch
export const DELETE = app.fetch
export const OPTIONS = app.fetch

// 本地开发：直接用 tsx 运行该文件时启动本地 HTTP server
if (process.argv[1] && process.argv[1].endsWith('[...all].ts')) {
  const { serve } = await import('@hono/node-server')
  const port = Number(process.env.PORT) || 3000
  console.log(`[dev] Starting Hono server on http://localhost:${port}`)
  serve({ fetch: app.fetch, port })
}