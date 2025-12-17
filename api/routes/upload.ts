import { Hono } from 'hono';
import { supabase, STORAGE_BUCKET } from '../lib/supabase.ts';

const r = new Hono();

// 直传 Supabase Storage，返回文件的 public URL（但 bucket 是私有的，返回的是路径）
r.post('/upload', async (c) => {
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!file || !(file as any).name) {
    return c.json({ ok: false, error: '缺少文件' }, 400);
  }
  const f = file as File;
  const ext = f.name.split('.').pop()?.toLowerCase() || 'dat';
  const key = `resume_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(key, f, { upsert: false });
  if (error) return c.json({ ok: false, error: error.message }, 500);
  const fileUrl = data?.path; // 私有路径
  return c.json({ ok: true, data: { fileUrl } });
});

export default r;