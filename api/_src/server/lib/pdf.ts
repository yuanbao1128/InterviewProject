// api/src/server/lib/pdf.ts
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // 或 SUPABASE_SERVICE_ROLE_KEY

const PDF_ENGINE = (process.env.PDF_ENGINE || 'js').toLowerCase(); // 'js' | 'poppler'
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 60000);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// 统一二进制守卫
function toU8(input: ArrayBuffer | Uint8Array | any): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input && typeof input === 'object' && typeof (input as ArrayBuffer).byteLength === 'number') {
    return new Uint8Array(input as ArrayBuffer);
  }
  throw new TypeError('Invalid binary input: expected ArrayBuffer/Uint8Array/Buffer');
}

// 给 Blob.arrayBuffer() 加超时与错误包装，防止卡住不返回
async function readBlobWithTimeout(blob: Blob, ms: number, traceId?: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let timeout: any;
  try {
    const p = blob.arrayBuffer();
    const t = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`blob.arrayBuffer timeout after ${ms}ms`));
      }, ms);
    });
    // 竞赛，谁先完成用谁
    const ab = await Promise.race([p, t]) as ArrayBuffer;
    return ab;
  } catch (e: any) {
    console.log('[pdf] storage.readBlob.error', JSON.stringify({ traceId, err: String(e?.message || e) }));
    throw e;
  } finally {
    clearTimeout(timeout);
    try { (controller as any).abort?.(); } catch {}
  }
}

// 下载文件为 ArrayBuffer（带 arrayBuffer 超时保护）
export async function downloadFromStorage(bucket: string, filePath: string, traceId?: string): Promise<ArrayBuffer> {
  const t0 = Date.now();
  console.log('[pdf] storage.download.start', JSON.stringify({ traceId, bucket, filePath }));
  const { data, error } = await supabase.storage.from(bucket).download(filePath);
  if (error) {
    const ms = Date.now() - t0;
    console.log('[pdf] storage.download.error', JSON.stringify({ traceId, bucket, filePath, ms, error: String(error.message || error) }));
    throw new Error(`Storage download failed: ${error.message}`);
  }
  // 关键：arrayBuffer 可能卡住或抛错，这里强制加超时
  const ab = await readBlobWithTimeout(data as Blob, PDF_TIMEOUT_MS, traceId);
  const ms = Date.now() - t0;
  const size = (data as any)?.size ?? (ab?.byteLength ?? null);
  console.log('[pdf] storage.download.ok', JSON.stringify({ traceId, bucket, filePath, ms, size }));
  return ab;
}

export async function pdfArrayBufferToText(ab: ArrayBuffer, traceId?: string): Promise<string> {
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

async function parseWithUnpdf(u8: Uint8Array, traceId?: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
  const tmpFile = path.join(tmpDir, 'input.pdf');

  try {
    const tWrite0 = Date.now();
    await fs.writeFile(tmpFile, Buffer.from(u8));
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: u8.byteLength }));

    console.log('[pdf] unpdf.start', JSON.stringify({ traceId, tmpFile }));
    const t0 = Date.now();

    const mod: any = await import('unpdf');
    const extractText: undefined | ((buf: Uint8Array, opts?: any) => Promise<{ text?: string } | string>) =
      (mod && typeof mod.extractText === 'function' && mod.extractText)
      || (mod && mod.default && typeof mod.default.extractText === 'function' && mod.default.extractText);

    if (!extractText) throw new Error('unpdf.extractText not found');

    const controller = new AbortController();
    const to = setTimeout(() => { try { (controller as any).abort?.(); } catch {} }, PDF_TIMEOUT_MS);

    try {
      const res = await extractText(u8, {
        mergePages: true,
        sortByY: true,
        signal: (controller as any).signal,
      });
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

async function parseWithPdfTextExtract(u8: Uint8Array, traceId?: string): Promise<string> {
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