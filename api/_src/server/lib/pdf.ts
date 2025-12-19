// api/src/server/lib/pdf.ts
import { createClient } from '@supabase/supabase-js';

// 注意：这里用你已有的变量名即可。如果你的环境变量叫 SUPABASE_SERVICE_KEY，就继续用它。
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!; // 或 SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export async function downloadFromStorage(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return await data.arrayBuffer();
}

// 统一将任意二进制视图转成 Node Buffer
function toNodeBuffer(x: ArrayBuffer | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  return Buffer.from(x as ArrayBuffer);
}

// 兼容 cjs/esm 导出
async function getExtractor(): Promise<any> {
  const mod: any = await import('pdf-text-extract');
  return mod?.default ?? mod;
}

export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  const extract = await getExtractor();
  const buffer = toNodeBuffer(buf);

  const pages = await new Promise<string[]>((resolve, reject) => {
    const cb = (err: any, out: string[] | string) => {
      if (err) return reject(err);
      resolve(Array.isArray(out) ? out : [out]);
    };

    // 关键：使用“对象入参”，显式 input=buffer 与 type='buffer'，
    // 避免任何 paths[0] 分支的内部处理逻辑。
    try {
      extract({ input: buffer, type: 'buffer', splitPages: true }, cb);
    } catch (e) {
      // 打印一次参数类型，便于排查
      console.error('pdf-text-extract call failed, argKinds:', {
        isBuffer: Buffer.isBuffer(buffer),
        typeOfFirst: typeof buffer,
      });
      reject(e);
    }
  });

  return normalizeText(pages.join('\n'));
}

function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}