import { Hono } from 'hono';
import { query } from '../lib/db.ts';

const r = new Hono();

r.get('/metrics', async (c) => {
  const { rows } = await query<any>(`select phase, count(*) as cnt from app.llm_calls group by phase`);
  return c.json({ ok: true, data: rows });
});

export default r;