// api/_src/server/server.ts
import { Hono } from 'hono'
import upload from './routes/upload.js'
import parseTask from './routes/parse-resume-task.js'
import startInterview from './routes/start-interview.js'
import nextQuestion from './routes/next-question.js'
import submitAnswer from './routes/submit-answer.js'
import report from './routes/report.js'
import finish from './routes/finish.js'
import metrics from './routes/metrics.js'

const app = new Hono()

app.route('/api', upload)
app.route('/api', parseTask)
app.route('/api', startInterview)
app.route('/api', nextQuestion)
app.route('/api', submitAnswer)
app.route('/api', report)
app.route('/api', finish)
app.route('/api', metrics)

export default app
export const config = { runtime: 'nodejs' }