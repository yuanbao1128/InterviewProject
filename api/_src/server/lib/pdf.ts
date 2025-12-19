// api/src/server/lib/pdf.ts
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // 或 SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export async function downloadFromStorage(bucket: string, filePath: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(filePath);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return await data.arrayBuffer();
}

// 兼容 cjs/esm 导出
async function getExtractor(): Promise<any> {
  const mod: any = await import('pdf-text-extract');
  return mod?.default ?? mod;
}

// 方案：写入临时文件 → 以“字符串路径签名”调用（避免任何对象/paths 歧义）
export async function pdfArrayBufferToText(ab: ArrayBuffer): Promise<string> {
  const extract = await getExtractor();

  // 1) 临时目录与文件
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    // 2) 落盘
    await fs.writeFile(tmpFile, Buffer.from(ab));

    // 3) 只传“字符串路径”，不用对象/数组，避免 paths[0] 类型误判
    const pages: string[] = await new Promise((resolve, reject) => {
      const cb = (err: any, out: string[] | string) => {
        if (err) return reject(err);
        resolve(Array.isArray(out) ? out : [out]);
      };
      try {
          console.log('[pdf] extract.invoked', { tmpFile });
        // 关键：这里仅传字符串
        extract(tmpFile, cb);
        console.log('[pdf] extract.cb.ok');
      } catch (e) {
          console.log('[pdf] extract.cb.error');
        reject(e);
      }
    });

    return normalizeText(pages.join('\n'));
  } finally {
    // 4) 清理
    try { await fs.unlink(tmpFile); } catch {}
    try { await fs.rmdir(tmpDir); } catch {}
  }
}

function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}