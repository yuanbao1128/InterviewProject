// api/src/server/lib/pdf.ts
import { supabase } from './supabase.js';

/**
 * 从 Supabase Storage 下载私有文件为 ArrayBuffer
 */
export async function downloadFromStorage(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return await data.arrayBuffer();
}

/**
 * 使用 pdf-text-extract 提取 PDF 文本（纯 Node，无 pdfjs/DOM）
 */
export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  // 动态导入，避免前端打包
  const mod: any = await import('pdf-text-extract');
  const extract = mod.default || mod;

  // 该库需要文件路径或 Buffer
  const buffer = Buffer.from(buf);

  const text: string = await new Promise((resolve, reject) => {
    extract(buffer, { splitPages: false }, (err: any, pages: string[] | string) => {
      if (err) return reject(err);
      const joined = Array.isArray(pages) ? pages.join('\n') : pages;
      resolve(joined || '');
    });
  });

  return normalizeText(text);
}

function normalizeText(s: string) {
  return s.replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}