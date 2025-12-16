import { Hono } from 'hono';
import { query } from '../lib/db';
import { client, MODEL } from '../lib/llm';
import fs from 'node:fs/promises';
import path from 'node:path';

const r = new Hono();

r.post('/submit-answer', async (c) => {
  const { interviewId, questionId, turnNo, content } = await c.req.json();
  if (!interviewId || !questionId || !turnNo || !content) return c.json({ ok: false, error: '缺少字段' }, 400);

  await query(`insert into app.answers (interview_id, question_id, turn_no, content) values ($1,$2,$3,$4)`, [interviewId, questionId, turnNo, content]);

  // 为该题打分
  const scoringPrompt = await fs.readFile(path.join(process.cwd(), 'api/lib/prompts/scoring.md'), 'utf-8');
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: scoringPrompt },
      { role: 'user', content: `题目：${questionId}\n候选人回答：${content}` }
    ],
    temperature: 0.2
  });

  let score: any = {};
  try { score = JSON.parse(res.choices[0]?.message?.content || '{}'); } catch { score = {}; }

  await query(
    `insert into app.scores (interview_id, question_id, overall, dimensions, evidence, suggestions)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      interviewId, questionId, score.overall ?? null,
      JSON.stringify(score.dimensions || {}),
      JSON.stringify(score.evidence || []),
      JSON.stringify(score.suggestions || [])
    ]
  );

  return c.json({ ok: true });
});

export default r;