// api/src/server/lib/pdf.ts
import { supabase } from './supabase.js'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs'

// 在 Node 环境为 pdfjs 指定 worker
GlobalWorkerOptions.workerSrc = pdfjsWorker as any

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
 * 使用 pdfjs-dist 将 PDF（二进制）提取为纯文本
 */
export async function pdfArrayBufferToText(buf: ArrayBuffer): Promise<string> {
  const loadingTask = getDocument({ data: buf })
  const pdf = await loadingTask.promise
  try {
    const max = pdf.numPages
    const chunks: string[] = []
    for (let i = 1; i <= max; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const strs = (content.items as any[]).map((it: any) => it.str).filter(Boolean)
      chunks.push(strs.join(' '))
    }
    const text = chunks.join('\n')
    return normalizeText(text)
  } finally {
    await pdf.cleanup()
    await pdf.destroy()
  }
}

/**
 * 简单文本清洗：去除多余空白
 */
function normalizeText(s: string) {
  return s.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}