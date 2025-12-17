// api/[...all].ts
// ① 在任何业务 import 之前加载本地环境变量（仅本地开发用）
// Vercel 部署时，平台会自动注入环境变量，这段不会产生副作用。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envLocal = path.join(__dirname, '.env.local')
const envFile = fs.existsSync(envLocal) ? envLocal : path.join(__dirname, '.env')
dotenv.config({ path: envFile })

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

app.use('', cors())
app.use('', prettyJSON())

// 统一挂到 /api
app.route('/api', upload)
app.route('/api', parseResume)
app.route('/api', startInterview)
app.route('/api', nextQuestion)
app.route('/api', submitAnswer)
app.route('/api', finish)
app.route('/api', report)
app.route('/api', metrics)

export const GET = app.fetch
export const POST = app.fetch
export const PUT = app.fetch
export const DELETE = app.fetch