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

  const { rows } = await query<{ id: string }>(
    `insert into app.resume_tasks (status, resume_file_url, resume_text)
     values ('pending', $1, $2) returning id`,
    [resumeFileUrl || null, resumeText || null]
  );
  const taskId = rows[0].id;

  console.log('[resume-task] start.accepted', JSON.stringify({ taskId, hasFileUrl: !!resumeFileUrl, hasText: !!resumeText }));

  // 异步处理
  processTask(taskId).catch((e) => {
    console.error('[resume-task] processTask unhandled', { taskId, err: String(e?.message || e) });
  });

  return c.json({ ok: true, data: { taskId } });
});

// 查询任务状态
r.get('/parse-resume-task/status', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ ok: false, error: '缺少 taskId' }, 400);
  const { rows } = await query<any>(`select id, status, result, error from app.resume_tasks where id = $1`, [taskId]);
  if (rows.length === 0) return c.json({ ok: false, error: '任务不存在' }, 404);

  const rec = rows[0];
  console.log('[resume-task] status.query', JSON.stringify({
    taskId, status: rec.status, hasResult: !!rec.result, hasError: !!rec.error
  }));
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
    const upd = await query(`update app.resume_tasks set status='processing' where id=$1 and status in ('pending')`, [taskId]);
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

    // 4) LLM 非流式调用（加入硬兜底超时与心跳日志）
    const sys =
      '你是资深招聘顾问，请将简历要点结构化提炼，严格输出 JSON：' +
      '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}';

    const t0 = Date.now();
    console.log('[resume-task] llm.start', JSON.stringify({ ...context, model: MODEL }));

    let content = '';
    // 兜底超时：避免上游长时间不首包导致“卡住不报错”
    const hardTimeoutMs = Number(process.env.LLM_HARD_TIMEOUT_MS || 90000); // 默认 90s
    const heartbeat = setInterval(() => {
      console.log('[resume-task] llm.waiting', JSON.stringify({ ...context, elapsed: Date.now() - t0 }));
    }, 2000);

    try {
      // 方式 A：沿用 SDK，但外面再包一层 Promise.race 做硬兜底超时
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

      console.log('[resume-task] llm.nostream.ok', JSON.stringify({ ...context, ms: Date.now() - t0, bytes: content.length }));

      // 方式 B：可选，绕过 SDK 直接 REST（排查 SDK 卡顿时启用）
      // const { restCompletion } = await import('../util-rest-llm.js'); // 需要你创建一个简单的 REST 调用工具
      // const contentByRest = await restCompletion(sys, rawText, MODEL, hardTimeoutMs);
      // content = contentByRest;
      // console.log('[resume-task] llm.rest.ok', JSON.stringify({ ...context, ms: Date.now() - t0, bytes: content.length }));
    } catch (e: any) {
      console.error('[resume-task] llm.nostream.error', JSON.stringify({ ...context, err: String(e?.message || e) }));
      throw e;
    } finally {
      clearInterval(heartbeat);
    }

    if (!content || !content.trim()) {
      throw new Error('LLM 返回空响应');
    }

    // 5) 审计
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

    // 6) JSON 解析（失败尝试修复）
    let parsed: any = {};
    try {
      parsed = JSON.parse(content || '{}');
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
        const fixed = tryFixJson(content || '');
        parsed = JSON.parse(fixed);
        console.log('[resume-task] json.parse.fixed.ok', JSON.stringify({ ...context, keys: Object.keys(parsed || {}).length }));
      } catch (e2: any) {
        throw new Error(`JSON 解析失败: ${String(e2?.message || e2)}`);
      }
    }

    // 7) 写回结果
    const tUpd0 = Date.now();
    const upd2 = await query(
      `update app.resume_tasks set status='done', result=$2, error=null where id=$1`,
      [taskId, JSON.stringify(parsed)]
    );
    ensureDbWriteOk(upd2, 'mark done');
    console.log('[resume-task] done', JSON.stringify({ ...context, ms: Date.now() - tUpd0 }));
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[resume-task] fail', JSON.stringify({ ...context, msg }));
    try {
      const tErr0 = Date.now();
      const updErr = await query(
        `update app.resume_tasks set status='error', error=$2 where id=$1`,
        [taskId, msg]
      );
      ensureDbWriteOk(updErr, 'mark error');
      console.log('[resume-task] error.persisted', JSON.stringify({ ...context, ms: Date.now() - tErr0 }));
    } catch (e2: any) {
      console.error('[resume-task] error.persist.failed', JSON.stringify({ ...context, err: String(e2?.message || e2) }));
    }
  } finally {
    console.log('[resume-task] process.end', JSON.stringify(context));
  }
}

function tryFixJson(s: string) {
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) return s.slice(i, j + 1);
  return '{}';
}

export const config = { runtime: 'nodejs' };