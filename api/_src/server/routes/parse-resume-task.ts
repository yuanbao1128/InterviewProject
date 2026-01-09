// api/src/server/routes/parse-resume-task.ts
import { Hono } from 'hono'
import { query, ensureDbWriteOk } from '../lib/db.js'
import { MODEL, restChatCompletion } from '../lib/llm.js'
import { STORAGE_BUCKET } from '../lib/supabase.js'
import { downloadFromStorage, pdfArrayBufferToText } from '../lib/pdf.js'
import { auditLLM } from '../lib/util.js'

const r = new Hono()

// 启动任务（完全异步：立即返回，由事件循环继续处理）
r.post('/parse-resume-task/start', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const resumeFileUrl = typeof body?.resumeFileUrl === 'string' ? body.resumeFileUrl.trim() : ''
  const resumeText = typeof body?.resumeText === 'string' ? body.resumeText.trim() : ''

  if (!resumeFileUrl && !resumeText) {
    return c.json({ ok: false, error: '缺少 resumeFileUrl 或 resumeText' }, 400)
  }

  const { rows } = await query<{ id: string }>(
    `insert into app.resume_tasks (status, resume_file_url, resume_text, created_at, updated_at)
     values ('pending', $1, $2, now(), now()) returning id`,
    [resumeFileUrl || null, resumeText || null]
  )
  const taskId = rows[0].id

  console.log('[resume-task] start.accepted', JSON.stringify({ taskId, hasFileUrl: !!resumeFileUrl, hasText: !!resumeText }))

  // 真正后台化：用微任务/下一个 tick 脱离请求生命周期
  setTimeout(() => {
    processTask(taskId).catch((e) => {
      console.error('[resume-task] processTask unhandled', { taskId, err: String(e?.message || e) })
    })
  }, 0)

  // 立即返回 taskId，前端自行轮询 /status
  return c.json({ ok: true, data: { taskId } })
})

// 查询任务状态（含“守护回收”：processing 超过 10 分钟自动置为 error）
r.get('/parse-resume-task/status', async (c) => {
  const taskId = c.req.query('taskId')
  if (!taskId) return c.json({ ok: false, error: '缺少 taskId' }, 400)

  try {
    const upd = await query(
      `update app.resume_tasks
       set status='error', error=coalesce(error,'expired by watchdog'), updated_at=now()
       where id=$1 and status='processing' and now() - updated_at > interval '10 minutes'`,
      [taskId]
    )
    if (upd.rowCount && upd.rowCount > 0) {
      console.log('[resume-task] watchdog.expired', JSON.stringify({ taskId, rowCount: upd.rowCount }))
    }
  } catch (e: any) {
    console.log('[resume-task] watchdog.skip', JSON.stringify({ taskId, err: String(e?.message || e) }))
  }

  const { rows } = await query<any>(`select id, status, result, error from app.resume_tasks where id = $1`, [taskId])
  if (rows.length === 0) return c.json({ ok: false, error: '任务不存在' }, 404)

  const rec = rows[0]
  console.log('[resume-task] status.query', JSON.stringify({
    taskId, status: rec.status, hasResult: !!rec.result, hasError: !!rec.error
  }))

  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  return c.json({ ok: true, data: { status: rec.status, result: rec.result ?? null, error: rec.error ?? null } })
})

// 新增：全局守护（可被定时触发），批量将超时 processing 置 error
r.post('/parse-resume-task/watchdog-sweep', async (c) => {
  const minutes = Number((await c.req.json().catch(() => ({})))?.minutes || 10)
  const { rowCount } = await query(
    `update app.resume_tasks
     set status='error', error=coalesce(error,'expired by watchdog sweep'), updated_at=now()
     where status='processing' and now() - updated_at > ($1::int || ' minutes')::interval`,
    [minutes]
  )
  console.log('[resume-task] watchdog.sweep', JSON.stringify({ minutes, affected: rowCount || 0 }))
  return c.json({ ok: true, data: { affected: rowCount || 0 } })
})

export default r

// 处理逻辑
async function processTask(taskId: string) {
  const context = { taskId }
  const startedAt = Date.now()
  console.log('[resume-task] process.start', JSON.stringify({
    ...context,
    runtime: { edge: (globalThis as any).EdgeRuntime || null, node: typeof process?.versions?.node }
  }))

  // 后台“保活心跳”，避免无日志导致平台回收
  const heartbeat = setInterval(() => {
    console.log('[resume-task] heartbeat', JSON.stringify({ ...context, aliveForMs: Date.now() - startedAt }))
  }, 2000)

  try {
    // 1) 标记 processing
    const tMark0 = Date.now()
    const upd = await safeUpdate(
      `update app.resume_tasks set status='processing', updated_at=now()
       where id=$1 and status in ('pending')`,
      [taskId],
      `update app.resume_tasks set status='processing'
       where id=$1 and status in ('pending')`
    )
    ensureDbWriteOk(upd, 'mark processing (maybe already processing/done/error)')
    console.log('[resume-task] mark.processing.ok', JSON.stringify({ ...context, ms: Date.now() - tMark0 }))

    // 小延迟，确保日志 flush
    await tinyYield()

    // 2) 读取任务输入
    const tRead0 = Date.now()
    const { rows } = await query<any>(`select id, resume_file_url, resume_text from app.resume_tasks where id=$1`, [taskId])
    console.log('[resume-task] task.read', JSON.stringify({ ...context, ms: Date.now() - tRead0, found: rows.length }))
    if (rows.length === 0) throw new Error('任务不存在')
    let rawText: string | null = rows[0].resume_text
    const fileUrl: string | null = rows[0].resume_file_url

    // 3) 下载并提取文本（如需要）
    if ((!rawText || !rawText.trim()) && fileUrl) {
      console.log('[resume-task] download.start', JSON.stringify({ ...context, bucket: STORAGE_BUCKET, fileUrl }))
      const tDl0 = Date.now()
      const buf = await downloadFromStorage(STORAGE_BUCKET, fileUrl, taskId)
      console.log('[resume-task] download.ok', JSON.stringify({ ...context, ms: Date.now() - tDl0, bytes: buf.byteLength }))

      await tinyYield()

      console.log('[resume-task] extract.start', JSON.stringify(context))
      const tEx0 = Date.now()
      rawText = await pdfArrayBufferToText(buf, taskId)
      console.log('[resume-task] extract.ok', JSON.stringify({ ...context, ms: Date.now() - tEx0, chars: (rawText || '').length }))
    }

    if (!rawText || !rawText.trim()) {
      console.log('[resume-task] no-text', JSON.stringify(context))
      throw new Error('未获取到简历文本')
    }

    // 4) LLM 调用（REST + AbortSignal）
    const sys =
      '你是资深招聘顾问，请将简历要点结构化提炼，严格输出 JSON：' +
      '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}'

    const t0 = Date.now()
    const hardTimeoutMs = Number(process.env.LLM_HARD_TIMEOUT_MS || 60000)
    const reqId = `${taskId.slice(0, 8)}-${t0}`
    console.log('[resume-task] llm.start', JSON.stringify({ ...context, reqId, model: MODEL, inputChars: (rawText || '').length, hardTimeoutMs }))

    let content = ''
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), hardTimeoutMs)
      try {
        content = await restChatCompletion({
          model: MODEL,
          system: sys,
          user: rawText!,
          temperature: 0.2,
          signal: ctrl.signal
        })
        console.log('[resume-task] llm.ok', JSON.stringify({ ...context, reqId, ms: Date.now() - t0, bytes: (content || '').length }))
      } finally {
        clearTimeout(timer)
      }
    } catch (e: any) {
      console.error('[resume-task] llm.error', JSON.stringify({ ...context, reqId, err: String(e?.message || e) }))
      throw e
    }

    if (!content || !content.trim()) {
      throw new Error('LLM 返回空响应')
    }

    // 5) 审计（可失败不阻塞）
    const latency = Date.now() - t0
    const tAudit0 = Date.now()
    try {
      await auditLLM(query, {
        interviewId: null,
        phase: 'parse',
        model: MODEL,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: latency,
        success: true,
        error: null
      })
      console.log('[resume-task] audit.ok', JSON.stringify({ ...context, ms: Date.now() - tAudit0 }))
    } catch (e: any) {
      console.log('[resume-task] audit.skip', JSON.stringify({ ...context, err: String(e?.message || e) }))
    }

    // 6) JSON 解析（增强修复）
    let parsed: any = {}
    try {
      const cleaned = stripCodeFence(content)
      parsed = JSON.parse(cleaned)
      console.log('[resume-task] json.parse.ok', JSON.stringify({ ...context, keys: Object.keys(parsed || {}).length }))
    } catch (e: any) {
      console.log('[resume-task] json.parse.fail.tryFix', JSON.stringify({
        ...context,
        err: String(e?.message || e),
        bytes: (content || '').length,
        head: (content || '').slice(0, 160),
        tail: (content || '').slice(-160)
      }))
      try {
        const fixed = tryFixJsonAdvanced(content || '')
        parsed = JSON.parse(fixed)
        console.log('[resume-task] json.parse.fixed.ok', JSON.stringify({ ...context, keys: Object.keys(parsed || {}).length }))
      } catch (e2: any) {
        parsed = { raw: content }
        console.log('[resume-task] json.parse.fixed.fail.storeRaw', JSON.stringify({ ...context, err: String(e2?.message || e2) }))
      }
    }

    // 7) 写回结果（带兜底）
    const tUpd0 = Date.now()
    try {
      const upd2 = await safeUpdate(
        `update app.resume_tasks set status='done', result=$2, error=null, updated_at=now() where id=$1`,
        [taskId, JSON.stringify(parsed)],
        `update app.resume_tasks set status='done', result=$2, error=null where id=$1`
      )
      ensureDbWriteOk(upd2, 'mark done')
      console.log('[resume-task] done', JSON.stringify({ ...context, ms: Date.now() - tUpd0 }))
    } catch (e: any) {
      console.error('[resume-task] done.write.error', JSON.stringify({ ...context, err: String(e?.message || e) }))
      const fallback = await safeUpdate(
        `update app.resume_tasks set status='done', updated_at=now() where id=$1`,
        [taskId],
        `update app.resume_tasks set status='done' where id=$1`
      )
      ensureDbWriteOk(fallback, 'mark done (fallback)')
      console.log('[resume-task] done.fallback', JSON.stringify({ ...context, ms: Date.now() - tUpd0 }))
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    console.error('[resume-task] fail', JSON.stringify({ ...context, msg }))
    try {
      const tErr0 = Date.now()
      const updErr = await safeUpdate(
        `update app.resume_tasks set status='error', error=$2, updated_at=now() where id=$1`,
        [taskId, msg],
        `update app.resume_tasks set status='error', error=$2 where id=$1`
      )
      ensureDbWriteOk(updErr, 'mark error')
      console.log('[resume-task] error.persisted', JSON.stringify({ ...context, ms: Date.now() - tErr0 }))
    } catch (e2: any) {
      console.error('[resume-task] error.persist.failed', JSON.stringify({ ...context, err: String(e2?.message || e2) }))
      try {
        const updErr2 = await safeUpdate(
          `update app.resume_tasks set status='error', updated_at=now() where id=$1`,
          [taskId],
          `update app.resume_tasks set status='error' where id=$1`
        )
        ensureDbWriteOk(updErr2, 'mark error (fallback2)')
        console.log('[resume-task] error.persisted.fallback2', JSON.stringify(context))
      } catch (e3: any) {
        console.error('[resume-task] error.persist.failed.fallback2', JSON.stringify({ ...context, err: String(e3?.message || e3) }))
      }
    }
  } finally {
    clearInterval(heartbeat)
    console.log('[resume-task] process.end', JSON.stringify(context))
  }
}

// 小让步：让事件循环在耗时步骤之间有机会调度，帮助日志持续刷新
function tinyYield(ms = 10) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

// 安全更新：当 updated_at 列缺失时降级
async function safeUpdate(sql: string, params: any[], fallbackSql: string) {
  try {
    return await query(sql, params)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg.includes('column "updated_at"') && msg.includes('does not exist')) {
      console.warn('[safeUpdate] fallback due to missing updated_at')
      return await query(fallbackSql, params)
    }
    return Promise.reject(e)
  }
}

// 去掉 Markdown 代码块包裹与 json: 前缀
function stripCodeFence(s: string) {
  let t = s.trim()
  t = t.replace(/^\s*json\s*:\s*/i, '').trim()
  const fence = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/m
  const m = t.match(fence)
  if (m && m[1]) t = m[1]
  return t.trim()
}

// 更鲁棒的 JSON 修复：提取第一段完整 JSON（{} 或 []），去 BOM、去尾逗号
function tryFixJsonAdvanced(s: string) {
  let t = stripCodeFence(s)
  t = t.replace(/^[^\{[]+/, '')
  t = t.replace(/\uFEFF/g, '')

  const pick = (u: string) => {
    const open = u.indexOf('{') >= 0 ? '{' : (u.indexOf('[') >= 0 ? '[' : '')
    if (!open) return ''
    const close = open === '{' ? '}' : ']'
    let depth = 0, start = -1, inStr = false, esc = false
    for (let i = 0; i < u.length; i++) {
      const ch = u[i]
      if (inStr) {
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') { inStr = false; continue }
        continue
      } else {
        if (ch === '"') { inStr = true; continue }
        if (ch === open) { if (depth === 0) start = i; depth++; continue }
        if (ch === close) { depth--; if (depth === 0 && start >= 0) return u.slice(start, i + 1) }
      }
    }
    return ''
  }

  let core = pick(t)
  if (!core) {
    const i = t.indexOf('{')
    const j = t.lastIndexOf('}')
    if (i >= 0 && j > i) core = t.slice(i, j + 1)
  }
  if (!core) core = '{}'
  core = core.replace(/,\s*(\}|])/g, '$1')
  return core
}

export const config = { runtime: 'nodejs' }