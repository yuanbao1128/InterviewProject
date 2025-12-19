import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function downloadFromStorage(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return await data.arrayBuffer();
}

export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  const extract: any = (await import('pdf-text-extract')).default ?? (await import('pdf-text-extract'));
  const buffer = Buffer.from(buf);

  const pages: string[] = await new Promise((resolve, reject) => {
    // 明确 Buffer 输入，避免被当作文件路径
    extract(buffer, { splitPages: true }, (err: any, out: string[] | string) => {
      if (err) return reject(err);
      resolve(Array.isArray(out) ? out : [out]);
    });
  });

  return normalizeText(pages.join('\n'));
}

function normalizeText(s: string) {
  return s.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}