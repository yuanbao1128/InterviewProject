// api/src/server/routes/parse-resume-task.ts
import { Hono } from 'hono';
import { query, ensureDbWriteOk } from '../lib/db.js';
import { client, MODEL } from '../lib/llm.js';
import { STORAGE_BUCKET } from '../lib/supabase.js';
import { downloadFromStorage, pdfArrayBufferToText } from '../lib/pdf.js';
import { auditLLM } from '../lib/util.js';

const r = new Hono();

// 启动任务
r.post('/parse-resume-task/start', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const resumeFileUrl = typeof body?.resumeFileUrl === 'string' ? body.resumeFileUrl.trim() : '';
  const resumeText = typeof body?.resumeText === 'string' ? body.resumeText.trim() : '';

  if (!resumeFileUrl && !resumeText) {
    return c.json({ ok: false, error: '缺少 resumeFileUrl 或 resumeText' }, 400);
  }

  // 插入时写 created_at/updated_at；若表结构异常，让错误尽早暴露
  const { rows } = await query<{ id: string }>(
    `insert into app.resume_tasks (status, resume_file_url, resume_text, created_at, updated_at)
     values ('pending', $1, $2, now(), now()) returning id`,
    [resumeFileUrl || null, resumeText || null]
  );
  const taskId = rows[0].id;

  console.log('[resume-task] start.accepted', JSON.stringify({ taskId, hasFileUrl: !!resumeFileUrl, hasText: !!resumeText }));

  // 异步处理
//   processTask(taskId).catch((e) => {
//     console.error('[resume-task] processTask unhandled', { taskId, err: String(e?.message || e) });
//   });

  try {
  const p = processTask(taskId);
  await Promise.race([
  p,
  new Promise((resolve) => setTimeout(resolve, 25000))
  ]);
  } catch (e) {
  console.error('[resume-task] process.inline.error', { taskId, err: String(e?.message || e) });
  }

  return c.json({ ok: true, data: { taskId } });
});

// 查询任务状态（含“守护回收”：processing 超过 10 分钟自动置为 error）
r.get('/parse-resume-task/status', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ ok: false, error: '缺少 taskId' }, 400);

  try {
    const upd = await query(
      `update app.resume_tasks
       set status='error', error=coalesce(error,'expired by watchdog'), updated_at=now()
       where id=$1 and status='processing' and now() - updated_at > interval '10 minutes'`,
      [taskId]
    );
    if (upd.rowCount && upd.rowCount > 0) {
      console.log('[resume-task] watchdog.expired', JSON.stringify({ taskId, rowCount: upd.rowCount }));
    }
  } catch (e: any) {
    console.log('[resume-task] watchdog.skip', JSON.stringify({ taskId, err: String(e?.message || e) }));
  }

  const { rows } = await query<any>(`select id, status, result, error from app.resume_tasks where id = $1`, [taskId]);
  if (rows.length === 0) return c.json({ ok: false, error: '任务不存在' }, 404);

  const rec = rows[0];
  console.log('[resume-task] status.query', JSON.stringify({
    taskId, status: rec.status, hasResult: !!rec.result, hasError: !!rec.error
  }));
  // 强制禁用缓存（Next/Vercel 某些场景可能缓存 GET）
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  return c.json({ ok: true, data: { status: rec.status, result: rec.result ?? null, error: rec.error ?? null } });
});

export default r;

// 处理逻辑
async function processTask(taskId: string) {
  const context = { taskId };
  console.log('[resume-task] process.start', JSON.stringify({
    ...context,
    runtime: { edge: (globalThis as any).EdgeRuntime || null, node: typeof process?.versions?.node }
  }));

  try {
    // 1) 标记 processing
    const tMark0 = Date.now();
    const upd = await safeUpdate(
      `update app.resume_tasks set status='processing', updated_at=now()
       where id=$1 and status in ('pending')`,
      [taskId],
      `update app.resume_tasks set status='processing'
       where id=$1 and status in ('pending')`
    );
    ensureDbWriteOk(upd, 'mark processing (maybe already processing/done/error)');
    console.log('[resume-task] mark.processing.ok', JSON.stringify({ ...context, ms: Date.now() - tMark0 }));

    // 2) 读取任务输入
    const tRead0 = Date.now();
    const { rows } = await query<any>(`select id, resume_file_url, resume_text from app.resume_tasks where id=$1`, [taskId]);
    console.log('[resume-task] task.read', JSON.stringify({ ...context, ms: Date.now() - tRead0, found: rows.length }));
    if (rows.length === 0) throw new Error('任务不存在');
    let rawText: string | null = rows[0].resume_text;
    const fileUrl: string | null = rows[0].resume_file_url;

    // 3) 下载并提取文本（如需要）
    if ((!rawText || !rawText.trim()) && fileUrl) {
      console.log('[resume-task] download.start', JSON.stringify({ ...context, bucket: STORAGE_BUCKET, fileUrl }));
      const tDl0 = Date.now();
      const buf = await downloadFromStorage(STORAGE_BUCKET, fileUrl, taskId);
      console.log('[resume-task] download.ok', JSON.stringify({ ...context, ms: Date.now() - tDl0, bytes: buf.byteLength }));

      console.log('[resume-task] extract.start', JSON.stringify(context));
      const tEx0 = Date.now();
      rawText = await pdfArrayBufferToText(buf, taskId);
      console.log('[resume-task] extract.ok', JSON.stringify({ ...context, ms: Date.now() - tEx0, chars: (rawText || '').length }));
    }

    if (!rawText || !rawText.trim()) {
      console.log('[resume-task] no-text', JSON.stringify(context));
      throw new Error('未获取到简历文本');
    }

    // 4) LLM 调用（增加硬兜底超时与心跳日志）
    const sys =
      '你是资深招聘顾问，请将简历要点结构化提炼，严格输出 JSON：' +
      '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}';

    const t0 = Date.now();
    console.log('[resume-task] llm.start', JSON.stringify({ ...context, model: MODEL }));

    let content = '';
    const hardTimeoutMs = Number(process.env.LLM_HARD_TIMEOUT_MS || 60000); // 默认 60s
    const heartbeat = setInterval(() => {
      console.log('[resume-task] llm.waiting', JSON.stringify({ ...context, elapsed: Date.now() - t0 }));
    }, 2000);

    try {
      // 用 SDK，但外层加 Promise.race 硬超时
      const p = client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: rawText }
        ],
        temperature: 0.2
      });

      const resp: any = await Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`llm hard timeout after ${hardTimeoutMs}ms`)), hardTimeoutMs))
      ]);

      const choice = resp?.choices?.[0];
      content = choice?.message?.content ?? '';
      console.log('[resume-task] llm.ok', JSON.stringify({ ...context, ms: Date.now() - t0, bytes: content.length }));
    } catch (e: any) {
      console.error('[resume-task] llm.error', JSON.stringify({ ...context, err: String(e?.message || e) }));
      throw e;
    } finally {
      clearInterval(heartbeat);
    }

    if (!content || !content.trim()) {
      throw new Error('LLM 返回空响应');
    }

    // 5) 审计（可失败不阻塞）
    const latency = Date.now() - t0;
    const tAudit0 = Date.now();
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
      });
      console.log('[resume-task] audit.ok', JSON.stringify({ ...context, ms: Date.now() - tAudit0 }));
    } catch (e: any) {
      console.log('[resume-task] audit.skip', JSON.stringify({ ...context, err: String(e?.message || e) }));
    }

    // 6) JSON 解析（增强修复）
    let parsed: any = {};
    try {
      const cleaned = stripCodeFence(content);
      parsed = JSON.parse(cleaned);
      console.log('[resume-task] json.parse.ok', JSON.stringify({ ...context, keys: Object.keys(parsed || {}).length }));
    } catch (e: any) {
      console.log('[resume-task] json.parse.fail.tryFix', JSON.stringify({
        ...context,
        err: String(e?.message || e),
        bytes: (content || '').length,
        head: (content || '').slice(0, 160),
        tail: (content || '').slice(-160)
      }));
      try {
        const fixed = tryFixJsonAdvanced(content || '');
        parsed = JSON.parse(fixed);
        console.log('[resume-task] json.parse.fixed.ok', JSON.stringify({ ...context, keys: Object.keys(parsed || {}).length }));
      } catch (e2: any) {
        // 仍失败则将原始内容以 raw 字段存入，避免卡住
        parsed = { raw: content };
        console.log('[resume-task] json.parse.fixed.fail.storeRaw', JSON.stringify({ ...context, err: String(e2?.message || e2) }));
      }
    }

    // 7) 写回结果（带兜底）
    const tUpd0 = Date.now();
    try {
      const upd2 = await safeUpdate(
        `update app.resume_tasks set status='done', result=$2, error=null, updated_at=now() where id=$1`,
        [taskId, JSON.stringify(parsed)],
        `update app.resume_tasks set status='done', result=$2, error=null where id=$1`
      );
      ensureDbWriteOk(upd2, 'mark done');
      console.log('[resume-task] done', JSON.stringify({ ...context, ms: Date.now() - tUpd0 }));
    } catch (e: any) {
      // 如果写 result 失败（例如列类型/约束），至少把状态改成 done，避免卡 processing
      console.error('[resume-task] done.write.error', JSON.stringify({ ...context, err: String(e?.message || e) }));
      const fallback = await safeUpdate(
        `update app.resume_tasks set status='done', updated_at=now() where id=$1`,
        [taskId],
        `update app.resume_tasks set status='done' where id=$1`
      );
      ensureDbWriteOk(fallback, 'mark done (fallback)');
      console.log('[resume-task] done.fallback', JSON.stringify({ ...context, ms: Date.now() - tUpd0 }));
    }
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[resume-task] fail', JSON.stringify({ ...context, msg }));
    try {
      const tErr0 = Date.now();
      const updErr = await safeUpdate(
        `update app.resume_tasks set status='error', error=$2, updated_at=now() where id=$1`,
        [taskId, msg],
        `update app.resume_tasks set status='error', error=$2 where id=$1`
      );
      ensureDbWriteOk(updErr, 'mark error');
      console.log('[resume-task] error.persisted', JSON.stringify({ ...context, ms: Date.now() - tErr0 }));
    } catch (e2: any) {
      console.error('[resume-task] error.persist.failed', JSON.stringify({ ...context, err: String(e2?.message || e2) }));
      // 最后一层兜底：至少把状态改掉（不带 error 字段）
      try {
        const updErr2 = await safeUpdate(
          `update app.resume_tasks set status='error', updated_at=now() where id=$1`,
          [taskId],
          `update app.resume_tasks set status='error' where id=$1`
        );
        ensureDbWriteOk(updErr2, 'mark error (fallback2)');
        console.log('[resume-task] error.persisted.fallback2', JSON.stringify(context));
      } catch (e3: any) {
        console.error('[resume-task] error.persist.failed.fallback2', JSON.stringify({ ...context, err: String(e3?.message || e3) }));
      }
    }
  } finally {
    console.log('[resume-task] process.end', JSON.stringify(context));
  }
}

// 安全更新：当 updated_at 列缺失时降级；也便于未来在 result 列问题时切换 SQL
async function safeUpdate(sql: string, params: any[], fallbackSql: string) {
  try {
    return await query(sql, params);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes('column "updated_at"') && msg.includes('does not exist')) {
      console.warn('[safeUpdate] fallback due to missing updated_at');
      return await query(fallbackSql, params);
    }
    return Promise.reject(e);
  }
}

// 去掉 Markdown 代码块包裹与 json: 前缀
function stripCodeFence(s: string) {
  let t = s.trim();
  // 提前去除可能的前缀“json:”
  t = t.replace(/^\s*json\s*:\s*/i, '').trim();
  // ```json ... ``` 或 ``` ... ```
  const fence = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/m;
  const m = t.match(fence);
  if (m && m[1]) t = m[1];
  return t.trim();
}

// 更鲁棒的 JSON 修复：提取第一段完整 JSON（{} 或 []），去 BOM、去尾逗号
function tryFixJsonAdvanced(s: string) {
  let t = stripCodeFence(s);
  t = t.replace(/^[^\{[]+/, ''); // 去掉前导非 JSON 结构字符
  t = t.replace(/\uFEFF/g, '');   // 去 BOM

  const pick = (u: string) => {
    const open = u.indexOf('{') >= 0 ? '{' : (u.indexOf('[') >= 0 ? '[' : '');
    if (!open) return '';
    const close = open === '{' ? '}' : ']';
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < u.length; i++) {
      const ch = u[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = false; continue; }
        continue;
      } else {
        if (ch === '"') { inStr = true; continue; }
        if (ch === open) { if (depth === 0) start = i; depth++; continue; }
        if (ch === close) { depth--; if (depth === 0 && start >= 0) return u.slice(start, i + 1); }
      }
    }
    return '';
  };

  let core = pick(t);
  if (!core) {
    const i = t.indexOf('{');
    const j = t.lastIndexOf('}');
    if (i >= 0 && j > i) core = t.slice(i, j + 1);
  }
  if (!core) core = '{}';
  // 去掉 JSON 尾逗号
  core = core.replace(/,\s*(\}|])/g, '$1');
  return core;
}

// 旧版简易修复（保留）
function tryFixJson(s: string) {
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) return s.slice(i, j + 1);
  return '{}';
}

export const config = { runtime: 'nodejs' };