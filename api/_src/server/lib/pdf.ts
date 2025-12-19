// api/src/server/lib/pdf.ts
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // 或 SUPABASE_SERVICE_ROLE_KEY
const PDF_ENGINE = (process.env.PDF_ENGINE || 'js').toLowerCase(); // 'js' | 'poppler'
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 60000); // 解析超时兜底

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

export async function pdfArrayBufferToText(ab: ArrayBuffer, traceId?: string): Promise<string> {
  // 引擎选择：默认 js（unpdf），显式要求 poppler 时尝试 pdftotext；若 pdftotext 不可用则回退 js。
  const engine = PDF_ENGINE === 'poppler' ? 'poppler' : 'js';
  if (engine === 'poppler') {
    const hasPdftotext = await canSpawnPdftotext(traceId);
    if (!hasPdftotext) {
      console.log('[pdf] engine.fallback', JSON.stringify({ traceId, from: 'poppler', to: 'js', reason: 'pdftotext not found' }));
      return await parseWithUnpdf(ab, traceId);
    }
    try {
      return await parseWithPdfTextExtract(ab, traceId);
    } catch (e: any) {
      console.log('[pdf] engine.poppler.error.fallback', JSON.stringify({ traceId, err: String(e?.message || e) }));
      return await parseWithUnpdf(ab, traceId);
    }
  } else {
    try {
      return await parseWithUnpdf(ab, traceId);
    } catch (e: any) {
      console.log('[pdf] engine.js.error', JSON.stringify({ traceId, err: String(e?.message || e) }));
      // 如果 pdftotext 存在，尝试回退
      const hasPdftotext = await canSpawnPdftotext(traceId);
      if (hasPdftotext) {
        console.log('[pdf] engine.fallback', JSON.stringify({ traceId, from: 'js', to: 'poppler' }));
        return await parseWithPdfTextExtract(ab, traceId);
      }
      throw e;
    }
  }
}

async function parseWithUnpdf(ab: ArrayBuffer, traceId?: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');
  try {
    const tWrite0 = Date.now();
    await fs.writeFile(tmpFile, Buffer.from(ab));
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: ab.byteLength }));

    console.log('[pdf] unpdf.start', JSON.stringify({ traceId, tmpFile }));
    const t0 = Date.now();

    const { default: unpdf } = await import('unpdf'); // 动态导入，避免边缘环境打包问题
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);

    try {
      const res = await unpdf.extractText(Buffer.from(ab), {
        mergePages: true,
        sortByY: true,
        signal: (controller as any).signal,
      } as any);
      const text = normalizeText(res?.text || '');
      console.log('[pdf] unpdf.ok', JSON.stringify({ traceId, ms: Date.now() - t0, chars: text.length }));
      return text;
    } finally {
      clearTimeout(to);
    }
  } catch (e: any) {
    console.log('[pdf] unpdf.error', JSON.stringify({ traceId, err: String(e?.message || e) }));
    throw e;
  } finally {
    try { await fs.unlink(tmpFile); console.log('[pdf] cleanup.file', JSON.stringify({ traceId, tmpFile })); } catch (e: any) {
      console.log('[pdf] cleanup.file.error', JSON.stringify({ traceId, tmpFile, err: String(e?.message || e) }));
    }
    try { await fs.rmdir(tmpDir); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })); } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }));
    }
  }
}

async function parseWithPdfTextExtract(ab: ArrayBuffer, traceId?: string): Promise<string> {
  // 保持你之前的“路径签名”策略，避免对象/数组歧义
  const { default: maybeDefault }: any = await import('pdf-text-extract');
  const extract = (maybeDefault || (await import('pdf-text-extract')) as any) as any;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    const tWrite0 = Date.now();
    await fs.writeFile(tmpFile, Buffer.from(ab));
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: ab.byteLength }));

    console.log('[pdf] extract.start', JSON.stringify({ traceId, tmpFile, engine: 'poppler' }));
    const t0 = Date.now();

    const text = await new Promise<string>((resolve, reject) => {
      let settled = false;

      const done = (err?: any, out?: string[] | string) => {
        if (settled) return;
        settled = true;
        if (err) {
          console.log('[pdf] extract.cb.error', JSON.stringify({ traceId, tmpFile, ms: Date.now() - t0, err: String(err?.message || err) }));
          reject(err);
        } else {
          const arr = Array.isArray(out) ? out : [out || ''];
          console.log('[pdf] extract.cb.ok', JSON.stringify({ traceId, tmpFile, ms: Date.now() - t0, pages: arr.length }));
          resolve(arr.join('\n'));
        }
      };

      // 超时兜底，避免挂起
      const to = setTimeout(() => done(new Error(`pdftotext timeout after ${PDF_TIMEOUT_MS}ms`)), PDF_TIMEOUT_MS);

      try {
        console.log('[pdf] extract.invoked', JSON.stringify({ traceId, tmpFile }));
        // 仅传字符串路径
        extract(tmpFile, (err: any, out: string[] | string) => {
          clearTimeout(to);
          done(err, out);
        });
      } catch (e: any) {
        clearTimeout(to);
        done(e);
      }
    });

    const normalized = normalizeText(text);
    console.log('[pdf] extract.normalize.ok', JSON.stringify({ traceId, chars: normalized.length }));
    return normalized;
  } catch (e: any) {
    console.log('[pdf] extract.error', JSON.stringify({ traceId, err: String(e?.message || e) }));
    throw e;
  } finally {
    try { await fs.unlink(tmpFile); console.log('[pdf] cleanup.file', JSON.stringify({ traceId, tmpFile })); } catch (e: any) {
      console.log('[pdf] cleanup.file.error', JSON.stringify({ traceId, tmpFile, err: String(e?.message || e) }));
    }
    try { await fs.rmdir(tmpDir); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })); } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }));
    }
  }
}

async function canSpawnPdftotext(traceId?: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    try {
      const t0 = Date.now();
      const ps = spawn('pdftotext', ['-v']);
      let responded = false;
      ps.on('error', (err) => {
        console.log('[pdf] pdftotext.check.error', JSON.stringify({ traceId, err: String(err?.message || err) }));
        resolve(false);
      });
      ps.on('exit', (code) => {
        responded = true;
        console.log('[pdf] pdftotext.check.exit', JSON.stringify({ traceId, code, ms: Date.now() - t0 }));
        resolve(code === 0 || code === 1); // -v 常见退出码 1 也算存在
      });
      setTimeout(() => {
        if (!responded) {
          console.log('[pdf] pdftotext.check.timeout', JSON.stringify({ traceId }));
          resolve(false);
        }
      }, 3000);
    } catch (e: any) {
      console.log('[pdf] pdftotext.check.throw', JSON.stringify({ traceId, err: String(e?.message || e) }));
      resolve(false);
    }
  });
}

function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}