import { Hono } from 'hono';
import { client, MODEL } from '../lib/llm';

const r = new Hono();

// 简历解析（纯文本/markdown 摘要），用于问题生成上下文
r.post('/parse-resume', async (c) => {
  const { text } = await c.req.json();
  if (!text || typeof text !== 'string') return c.json({ ok: false, error: '缺少简历文本' }, 400);

  const sys = '你是资深招聘顾问，请将简历要点结构化提炼，输出 JSON：{summary: string, highlights: string[], skills: string[], projects: [{name, role, contributions: string[], metrics: string[]}]}';
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ],
    temperature: 0.2
  });

  const content = res.choices[0]?.message?.content || '{}';
  return c.json({ ok: true, data: JSON.parse(content) });
});

export default r;