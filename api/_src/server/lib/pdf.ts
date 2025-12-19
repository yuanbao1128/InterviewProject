// api/src/server/lib/pdf.ts
import extractOrig = require('pdf-text-extract');

type ExtractFn = typeof extractOrig;

// 包一层，兼容 default / cjs 导出
async function getExtractor(): Promise<ExtractFn> {
  const mod: any = await import('pdf-text-extract');
  return (mod.default || mod) as ExtractFn;
}

export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  const extract = await getExtractor();
  const buffer = Buffer.from(buf);

  const pages = await new Promise<string[]>((resolve, reject) => {
    // 显式指明是 Buffer 输入，避免被当作路径
    (extract as any)({ input: buffer, type: 'buffer', splitPages: true }, (err: any, out: string[] | string) => {
      if (err) return reject(err);
      resolve(Array.isArray(out) ? out : [out]);
    });
  });

  return normalizeText(pages.join('\n'));
}

function normalizeText(s: string) {
  return s.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
function toNodeBuffer(x: ArrayBuffer | Uint8Array | Buffer) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  return Buffer.from(x as ArrayBuffer);
}