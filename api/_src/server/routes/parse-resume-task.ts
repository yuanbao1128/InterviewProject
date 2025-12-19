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

  // 创建任务记录
  const { rows } = await query<{ id: string }>(
    `insert into app.resume_tasks (status, resume_file_url, resume_text)
     values ('pending', $1, $2) returning id`,
    [resumeFileUrl || null, resumeText || null]
  );
  const taskId = rows[0].id;

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
  return c.json({ ok: true, data: { status: rec.status, result: rec.result ?? null, error: rec.error ?? null } });
});

export default r;

/**
 * 实际处理逻辑：下载/解析 PDF → 调用 LLM → 写回结果
 * 采用 DeepSeek，可开启 stream，但我们把流聚合成完整文本再 JSON.parse。
 */
async function processTask(taskId: string) {
    console.log('[runtime]', { edge: (globalThis as any).EdgeRuntime, node: typeof process?.versions?.node });
  // 将任务标记为 processing
  await query(`update app.resume_tasks set status='processing' where id=$1 and status='pending'`, [taskId]);

  // 重新读取任务（可拿 resume_file_url 或 resume_text）
  const { rows } = await query<any>(
    `select id, resume_file_url, resume_text from app.resume_tasks where id = $1`,
    [taskId]
  );
  if (rows.length === 0) return;

  let rawText = rows[0].resume_text as string | null;
  const fileUrl = rows[0].resume_file_url as string | null;

  try {
    if (!rawText && fileUrl) {
      // 从 Supabase Storage 下载并转文本
      console.log('[resume-task] download.start', { taskId, fileUrl });
      const buf = await downloadFromStorage(STORAGE_BUCKET, fileUrl);
      console.log('[resume-task] download.ok', { taskId, size: buf.byteLength });
      console.log('[resume-task] extract.start', { taskId });
      rawText = await pdfArrayBufferToText(buf);
      console.log('[resume-task] extract.ok', { taskId, chars: rawText.length });
    }
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('未获取到简历文本');
    }

    const sys =
      '你是资深招聘顾问，请将简历要点结构化提炼，严格输出 JSON：' +
      '{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}';

    const t0 = Date.now();

    // 方式1：非流式（简单稳定）
    // const res = await client.chat.completions.create({
    //   model: MODEL,
    //   messages: [
    //     { role: 'system', content: sys },
    //     { role: 'user', content: rawText }
    //   ],
    //   temperature: 0.2
    // });

    // 方式2：流式（DeepSeek 支持），聚合内容
    console.log('[resume-task] llm.start', { taskId, model: MODEL });
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: rawText }
      ],
      temperature: 0.2,
      stream: true
    });
    console.log('[resume-task] llm.stream.end', { taskId, bytes: (content||'').length });

    let content = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) content += delta;
    }

    const latency = Date.now() - t0;

    // 审计（尽量补充 usage，如果流式没有 usage，这里只记录基础信息）
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

    let parsed: any = {};
    try {
      parsed = JSON.parse(content || '{}');
    } catch (e: any) {
      // 再尝试一次：包裹 JSON 清洗
      const fixed = tryFixJson(content || '');
      parsed = JSON.parse(fixed);
    }

    await query(
      `update app.resume_tasks set status='done', result=$2, error=null where id=$1`,
      [taskId, JSON.stringify(parsed)]
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[resume-task] fail', { taskId, msg });
    await query(
      `update app.resume_tasks set status='error', error=$2 where id=$1`,
      [taskId, msg]
    );
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