// api/src/server/lib/pdf.ts
import { supabase } from './supabase.js';

/**
 * 从 Supabase Storage 下载私有文件为 ArrayBuffer
 */
export async function downloadFromStorage(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  // data 是 Blob
  return await data.arrayBuffer();
}

/**
 * 使用 pdf-parse 将 PDF（二进制）提取为纯文本
 * 说明：
 * - 采用动态导入 CommonJS 入口（pdf-parse 默认导出）以兼容 ESM 环境
 * - 该实现不依赖 DOM/Canvas，适用于 Node.js Runtime（Vercel Serverless / Node 运行时）
 */
export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  // 动态导入 CommonJS 入口。注意这里不带子路径，直接 'pdf-parse'
  const mod: any = await import('pdf-parse');
  const pdfParse = mod.default || mod; // 兼容不同打包方式

  const b = Buffer.from(buf);
  const res = await pdfParse(b);
  return normalizeText(res?.text || '');
}

/**
 * 简单文本清洗：去除 NUL、压缩空白、规范换行
 */
function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')          // 去除 NUL
    .replace(/[ \t]+/g, ' ')         // 连续空格/Tab 压缩为一个空格
    .replace(/\s*\n\s*/g, '\n')      // 规范换行两侧空白
    .trim();
}