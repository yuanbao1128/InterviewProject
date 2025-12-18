// api/src/server/lib/pdf.ts
import { supabase } from './supabase.js'

/**
 * 从 Supabase Storage 下载私有文件为 ArrayBuffer
 */
export async function downloadFromStorage(bucket: string, path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw new Error(`Storage download failed: ${error.message}`)
  // data 是 Blob
  return await data.arrayBuffer()
}

/**
 * 使用 pdf-parse 将 PDF（二进制）提取为纯文本
 * 说明：
 * - 采用动态导入 CommonJS 入口（pdf-parse 默认导出）以兼容 ESM 环境
 * - 避免直接依赖 ESM 子路径（不同版本路径可能变化）
 */
export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  // 动态导入 CommonJS 入口。注意这里不带子路径，直接 'pdf-parse'
  const mod: any = await import('pdf-parse')
  const pdfParse = mod.default || mod // 兼容不同打包方式

  const b = Buffer.from(buf)
  const res = await pdfParse(b)
  return normalizeText(res.text || '')
}

/**
 * 简单文本清洗：去除多余空白
 */
function normalizeText(s: string) {
  return s.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}