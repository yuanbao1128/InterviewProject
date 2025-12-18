export function assertEnv(keys: string[]) {
  for (const k of keys) {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  }
}

export function ok<T>(data: T) {
  return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
}
export function err(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), { status, headers: { 'content-type': 'application/json' } });
}

export function nowISO() {
  return new Date().toISOString();
}

export async function auditLLM(queryFn: (sql: string, params?: any[]) => Promise<any>, rec: {
  interviewId?: string | null,
  phase: 'planning'|'question'|'score'|'report'|'parse',
  model: string,
  promptTokens?: number|null,
  completionTokens?: number|null,
  totalTokens?: number|null,
  latencyMs?: number|null,
  success?: boolean,
  error?: string|null
}) {
  try {
    await queryFn(
      `insert into app.llm_calls (interview_id, phase, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, success, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        rec.interviewId || null,
        rec.phase,
        rec.model,
        rec.promptTokens ?? null,
        rec.completionTokens ?? null,
        rec.totalTokens ?? null,
        rec.latencyMs ?? null,
        rec.success ?? true,
        rec.error ?? null
      ]
    );
  } catch {
    // 忽略审计写入失败
  }
}