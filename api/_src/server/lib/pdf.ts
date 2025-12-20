// api/src/server/lib/pdf.ts
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // 或 SUPABASE_SERVICE_ROLE_KEY

// 引擎选择：默认纯 JS；如设置 PDF_ENGINE=poppler 且检测到 pdftotext 存在，则优先用 poppler
const PDF_ENGINE = (process.env.PDF_ENGINE || 'js').toLowerCase(); // 'js' | 'poppler'
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 60000); // 超时兜底

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// 更鲁棒的二进制守卫：支持 ArrayBuffer / Uint8Array / Buffer
function toU8(input: ArrayBuffer | Uint8Array | any): Uint8Array {
  if (input instanceof Uint8Array) return input;
  // Node Buffer 兼容
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(input)) {
    // 使用同一底层 ArrayBuffer，避免复制；保持视图范围正确
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  // ArrayBuffer
  if (input && typeof input === 'object' && typeof (input as ArrayBuffer).byteLength === 'number') {
    return new Uint8Array(input as ArrayBuffer);
  }
  throw new TypeError('Invalid binary input: expected ArrayBuffer/Uint8Array/Buffer');
}

// 下载文件为 ArrayBuffer
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
  const size = (data as any)?.size ?? (ab?.byteLength ?? null);
  console.log('[pdf] storage.download.ok', JSON.stringify({ traceId, bucket, filePath, ms, size }));
  return ab;
}

// 统一入口：根据引擎选择解析
export async function pdfArrayBufferToText(ab: ArrayBuffer, traceId?: string): Promise<string> {
  // 重要：统一转为 Uint8Array，避免库要求“请传 Uint8Array 而非 Buffer”的错误
  const u8 = toU8(ab);

  const wantPoppler = PDF_ENGINE === 'poppler';
  if (wantPoppler) {
    const ok = await canSpawnPdftotext(traceId);
    if (!ok) {
      console.log('[pdf] engine.fallback', JSON.stringify({ traceId, from: 'poppler', to: 'js', reason: 'pdftotext not found' }));
      return await parseWithUnpdf(u8, traceId);
    }
    try {
      return await parseWithPdfTextExtract(u8, traceId);
    } catch (e: any) {
      console.log('[pdf] engine.poppler.error.fallback', JSON.stringify({ traceId, err: String(e?.message || e) }));
      return await parseWithUnpdf(u8, traceId);
    }
  } else {
    try {
      return await parseWithUnpdf(u8, traceId);
    } catch (e: any) {
      console.log('[pdf] engine.js.error', JSON.stringify({ traceId, err: String(e?.message || e) }));
      const ok = await canSpawnPdftotext(traceId);
      if (ok) {
        console.log('[pdf] engine.fallback', JSON.stringify({ traceId, from: 'js', to: 'poppler' }));
        return await parseWithPdfTextExtract(u8, traceId);
      }
      throw e;
    }
  }
}

// 纯 JS 引擎（unpdf）：要求传入 Uint8Array/Buffer，但为严谨起见统一传 Uint8Array
async function parseWithUnpdf(u8: Uint8Array, traceId?: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    const tWrite0 = Date.now();
    await fs.writeFile(tmpFile, Buffer.from(u8));
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: u8.byteLength }));

    console.log('[pdf] unpdf.start', JSON.stringify({ traceId, tmpFile }));
    const t0 = Date.now();

    // 动态导入并兼容不同导出形态
    const mod: any = await import('unpdf');
    const extractText: undefined | ((buf: Uint8Array, opts?: any) => Promise<{ text?: string } | string>) =
      (mod && typeof mod.extractText === 'function' && mod.extractText)
      || (mod && mod.default && typeof mod.default.extractText === 'function' && mod.default.extractText);

    if (!extractText) {
      throw new Error('unpdf.extractText not found');
    }

    // 一些库支持 AbortSignal，这里提供一个超时控制；若不支持也不影响
    const controller = new AbortController();
    const to = setTimeout(() => {
      try { (controller as any).abort?.(); } catch {}
    }, PDF_TIMEOUT_MS);

    try {
      // 关键：传入 Uint8Array，而非 Node Buffer
      const res = await extractText(u8, {
        mergePages: true,
        sortByY: true,
        signal: (controller as any).signal,
      });
      // 兼容不同返回形态：字符串或对象
      const rawText = (typeof res === 'string') ? res : (res?.text ?? '');
      const text = normalizeText(rawText);
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
    try { await fs.rm(tmpDir, { recursive: true, force: true }); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })); } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }));
    }
  }
}

// poppler 引擎（pdf-text-extract）：Vercel 默认无 pdftotext，会自动回退；自托管可使用
async function parseWithPdfTextExtract(u8: Uint8Array, traceId?: string): Promise<string> {
  // 兼容 default/命名导出
  const mod: any = await import('pdf-text-extract').catch((e: any) => {
    throw new Error(`pdf-text-extract import failed: ${e?.message || e}`);
  });
  const extract = (mod?.default || mod) as any;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    const tWrite0 = Date.now();
    await fs.writeFile(tmpFile, Buffer.from(u8));
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: u8.byteLength }));

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

      const to = setTimeout(() => done(new Error(`pdftotext timeout after ${PDF_TIMEOUT_MS}ms`)), PDF_TIMEOUT_MS);

      try {
        console.log('[pdf] extract.invoked', JSON.stringify({ traceId, tmpFile }));
        // 只传字符串路径，避免 paths/Buffer 签名差异
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
    try { await fs.rm(tmpDir, { recursive: true, force: true }); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })); } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }));
    }
  }
}

// 检测 pdftotext 是否存在，避免 ENOENT 导致进程崩溃
async function canSpawnPdftotext(traceId?: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    try {
      const t0 = Date.now();
      const ps = spawn('pdftotext', ['-v']);
      let resolved = false;
      ps.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          console.log('[pdf] pdftotext.check.error', JSON.stringify({ traceId, err: String(err?.message || err) }));
          resolve(false);
        }
      });
      ps.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          console.log('[pdf] pdftotext.check.exit', JSON.stringify({ traceId, code, ms: Date.now() - t0 }));
          resolve(code === 0 || code === 1);
        }
      });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
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