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