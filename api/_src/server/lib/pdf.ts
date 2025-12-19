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

export async function downloadFromStorage(bucket: string, filePath: string, traceId?: string): Promise<ArrayBuffer> {
  const t0 = Date.now();
  console.log('[pdf] storage.download.start', JSON.stringify({ traceId, bucket, filePath }));
  const { data, error } = await supabase.storage.from(bucket).download(filePath);
  if (error) {
    const ms = Date.now() - t0;
    console.log('[pdf] storage.download.error', JSON.stringify({ traceId, bucket, filePath, ms, error: String(error.message || error) }));
    throw new Error(`Storage download failed: ${error.message}`);
  }
  const ab = await data.arrayBuffer();
  const ms = Date.now() - t0;
  console.log('[pdf] storage.download.ok', JSON.stringify({ traceId, bucket, filePath, ms, size: (data as any)?.size ?? (ab?.byteLength ?? null) }));
  return ab;
}

// 兼容 cjs/esm 导出
async function getExtractor(): Promise<any> {
  const mod: any = await import('pdf-text-extract');
  return mod?.default ?? mod;
}

// 方案：写入临时文件 → 以“字符串路径签名”调用（避免任何对象/paths 歧义）
export async function pdfArrayBufferToText(ab: ArrayBuffer, traceId?: string): Promise<string> {
  const extract = await getExtractor();

  // 1) 临时目录与文件
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    // 2) 落盘
    const tWrite0 = Date.now();
    await fs.writeFile(tmpFile, Buffer.from(ab));
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: ab.byteLength }));

    // 3) 只传“字符串路径”，不用对象/数组，避免 paths[0] 类型误判
    console.log('[pdf] extract.start', JSON.stringify({ traceId, tmpFile }));
    const t0 = Date.now();
    const pages: string[] = await new Promise((resolve, reject) => {
      const cb = (err: any, out: string[] | string) => {
        if (err) {
          console.log('[pdf] extract.cb.error', JSON.stringify({ traceId, tmpFile, ms: Date.now() - t0, err: String(err?.message || err) }));
          return reject(err);
        }
        const arr = Array.isArray(out) ? out : [out];
        console.log('[pdf] extract.cb.ok', JSON.stringify({ traceId, tmpFile, ms: Date.now() - t0, pages: arr.length }));
        resolve(arr);
      };
      try {
        console.log('[pdf] extract.invoked', JSON.stringify({ traceId, tmpFile }));
        // 关键：这里仅传字符串
        extract(tmpFile, cb);
      } catch (e: any) {
        console.log('[pdf] extract.invoke.error', JSON.stringify({ traceId, tmpFile, err: String(e?.message || e) }));
        reject(e);
      }
    });

    const text = normalizeText(pages.join('\n'));
    console.log('[pdf] normalize.ok', JSON.stringify({ traceId, chars: text.length }));
    return text;
  } finally {
    // 4) 清理
    try { await fs.unlink(tmpFile); console.log('[pdf] cleanup.file', JSON.stringify({ traceId, tmpFile })); } catch (e: any) {
      console.log('[pdf] cleanup.file.error', JSON.stringify({ traceId, tmpFile, err: String(e?.message || e) }));
    }
    try { await fs.rmdir(tmpDir); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })); } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }));
    }
  }
}

function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}