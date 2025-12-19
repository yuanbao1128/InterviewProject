// api/src/server/routes/parse-resume-task.ts

import { Hono } from 'hono';
import { query } from '../lib/db.js';
import { client, MODEL } from '../lib/llm.js';
import { STORAGE_BUCKET } from '../lib/supabase.js';
import { downloadFromStorage, pdfArrayBufferToText } from '../lib/pdf.js';
import { auditLLM } from '../lib/util.js';

const r = new Hono();

/**
 * 启动任务
 * body:
 *  - resumeFileUrl?: string  后端可自行下载并解析
 *  - resumeText?: string     或者直接传纯文本
 * 返回: { ok: true, data: { taskId } }
 */
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

  // 立刻触发后台异步处理（fire-and-forget）
  processTask(taskId).catch((e) => {
    console.error('[resume-task] processTask unhandled', e);
  });

  return c.json({ ok: true, data: { taskId } });
});

/**
 * 查询任务状态
 * query: ?taskId=...
 * 返回:
 *  - pending/processing: { ok:true, data:{ status } }
 *  - done: { ok:true, data:{ status:'done', result } }
 *  - error: { ok:true, data:{ status:'error', error } }
 */
r.get('/parse-resume-task/status', async (c) => {
  const taskId = c.req.query('taskId');
  if (!taskId) return c.json({ ok: false, error: '缺少 taskId' }, 400);

  const { rows } = await query<any>(`select id, status, result, error from app.resume_tasks where id = $1`, [taskId]);
  if (rows.length === 0) return c.json({ ok: false, error: '任务不存在' }, 404);

  const rec = rows[0];
  console.log('[resume-task] status.query', JSON.stringify({ taskId, status: rec.status, hasResult: !!rec.result, hasError: !!rec.error }));
  return c.json({ ok: true, data: { status: rec.status, result: rec.result ?? null, error: rec.error ?? null } });
});

export default r;

/**
 * 实际处理逻辑：下载/解析 PDF → 调用 LLM → 写回结果
 * 采用 DeepSeek，可开启 stream，但我们把流聚合成完整文本再 JSON.parse。
 */
async function processTask(taskId: string) {
  console.log('[resume-task] process.start', JSON.stringify({ taskId, runtime: { edge: (globalThis as any).EdgeRuntime || null, node: typeof process?.versions?.node } }));
  // 将任务标记为 processing
  const tMark0 = Date.now();
  await query(`update app.resume_tasks set status='processing' where id=$1 and status='pending'`, [taskId]);
  console.log('[resume-task] mark.processing.ok', JSON.stringify({ taskId, ms: Date.now() - tMark0 }));

  // 重新读取任务（可拿 resume_file_url 或 resume_text）
  const tRead0 = Date.now();
  const { rows } = await query<any>(
    `select id, resume_file_url, resume_text from app.resume_tasks where id = $1`,
    [taskId]
  );
  console.log('[resume-task] task.read', JSON.stringify({ taskId, ms: Date.now() - tRead0, found: rows.length }));
  if (rows.length === 0) return;

  let rawText = rows[0].resume_text as string | null;
  const fileUrl = rows[0].resume_file_url as string | null;

  try {
    if (!rawText && fileUrl) {
      console.log('[resume-task] download.start', JSON.stringify({ taskId, bucket: STORAGE_BUCKET, fileUrl }));
      const tDl0 = Date.now();
      // 从 Supabase Storage 下载并转文本
      const buf = await downloadFromStorage(STORAGE_BUCKET, fileUrl, taskId);
      console.log('[resume-task] download.ok', JSON.stringify({ taskId, ms: Date.now() - tDl0, bytes: buf.byteLength }));

      console.log('[resume-task] extract.start', JSON.stringify({ taskId }));
      const tEx0 = Date.now();
      rawText = await pdfArrayBufferToText(buf, taskId);
      console.log('[resume-task] extract.ok', JSON.stringify({ taskId, ms: Date.now() - tEx0, chars: (rawText || '').length }));
    }
    if (!rawText || rawText.trim().length === 0) {
      console.log('[resume-task] no-text', JSON.stringify({ taskId }));
      throw new Error('未获取到简历文本');
    }

    const sys =
      '你是资深招聘顾问，请将简历要点结构化提炼，严格输出 JSON：' +
      '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}' ;

    const t0 = Date.now();
    console.log('[resume-task] llm.start', JSON.stringify({ taskId, model: MODEL }));

    // 方式2：流式（DeepSeek 支持），聚合内容
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: rawText }
      ],
      temperature: 0.2,
      stream: true
    });
    console.log('[resume-task] llm.stream.open', JSON.stringify({ taskId }));

    let content = '';
    let chunks = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        content += delta;
      }
      chunks++;
      // 可选：每 50 块打印一次心跳，避免长时间无日志
      if (chunks % 50 === 0) {
        console.log('[resume-task] llm.stream.heartbeat', JSON.stringify({ taskId, chunks, bytes: content.length }));
      }
    }
    console.log('[resume-task] llm.stream.end', JSON.stringify({ taskId, chunks, bytes: content.length, ms: Date.now() - t0 }));

    const latency = Date.now() - t0;

    // 审计（尽量补充 usage，如果流式没有 usage，这里只记录基础信息）
    const tAudit0 = Date.now();
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
    console.log('[resume-task] audit.ok', JSON.stringify({ taskId, ms: Date.now() - tAudit0 }));

    let parsed: any = {};
    try {
      parsed = JSON.parse(content || '{}');
      console.log('[resume-task] json.parse.ok', JSON.stringify({ taskId, keys: Object.keys(parsed || {}).length }));
    } catch (e: any) {
      console.log('[resume-task] json.parse.fail.tryFix', JSON.stringify({ taskId, err: String(e?.message || e) }));
      // 再尝试一次：包裹 JSON 清洗
      const fixed = tryFixJson(content || '');
      parsed = JSON.parse(fixed);
      console.log('[resume-task] json.parse.fixed.ok', JSON.stringify({ taskId, keys: Object.keys(parsed || {}).length }));
    }

    const tUpd0 = Date.now();
    await query(
      `update app.resume_tasks set status='done', result=$2, error=null where id=$1`,
      [taskId, JSON.stringify(parsed)]
    );
    console.log('[resume-task] done', JSON.stringify({ taskId, ms: Date.now() - tUpd0 }));
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[resume-task] fail', JSON.stringify({ taskId, msg }));
    const tErr0 = Date.now();
    await query(
      `update app.resume_tasks set status='error', error=$2 where id=$1`,
      [taskId, msg]
    );
    console.log('[resume-task] error.persisted', JSON.stringify({ taskId, ms: Date.now() - tErr0 }));
  }
}

function tryFixJson(s: string) {
  // 简单兜底：截取第一个 { 到最后一个 } 之间的内容
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) return s.slice(i, j + 1);
  return s;
}
export const config = { runtime: 'nodejs' };