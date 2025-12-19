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

// 方案：写入临时文件，再用路径交给 pdf-text-extract（最稳定）
export async function pdfArrayBufferToText(ab: ArrayBuffer): Promise<string> {
  const extract = await getExtractor();

  // 1) 在系统临时目录创建独立文件夹
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    // 2) 写入临时文件
    await fs.writeFile(tmpFile, Buffer.from(ab));

    // 3) 以“路径”方式调用（该库最稳定的用法）
    const pages: string[] = await new Promise((resolve, reject) => {
      const cb = (err: any, out: string[] | string) => {
        if (err) return reject(err);
        resolve(Array.isArray(out) ? out : [out]);
      };
      // 二选一都可以（建议用对象形式，方便加选项）
      // extract(tmpFile, cb);
      extract({ paths: [tmpFile], splitPages: true }, cb);
    });

    return normalizeText(pages.join('\n'));
  } finally {
    // 4) 清理临时文件与目录（忽略清理错误）
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