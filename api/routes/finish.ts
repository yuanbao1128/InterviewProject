import { Hono } from 'hono';
import { query } from '../lib/db.ts';

const r = new Hono();

r.post('/finish', async (c) => {
  const { interviewId } = await c.req.json();
  if (!interviewId) return c.json({ ok: false, error: '缺少 interviewId' }, 400);

  await query(`update app.interviews set status='finished', finished_at=now() where id=$1`, [interviewId]);
  return c.json({ ok: true });
});

export default r;