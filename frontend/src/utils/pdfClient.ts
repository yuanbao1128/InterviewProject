// src/utils/pdfClient.ts
// 浏览器端 PDF → 纯文本解析（仅依赖 pdfjs-dist，无需 canvas 渲染）
// 安装依赖：npm i pdfjs-dist
import * as pdfjsLib from 'pdfjs-dist'

// 在 Vite/webpack 环境下，设置 worker 源（使用内联 worker 兼容多数环境）
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min?url'
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfjsWorker

export async function pdfFileToText(file: File, opts?: { maxPages?: number }) {
  const arrayBuffer = await file.arrayBuffer()
  return pdfArrayBufferToText(arrayBuffer, opts)
}

export async function pdfArrayBufferToText(buf: ArrayBuffer, opts?: { maxPages?: number }) {
  const loadingTask = (pdfjsLib as any).getDocument({ data: buf })
  const pdf = await loadingTask.promise
  const max = opts?.maxPages ?? 20 // 可限制最大页数
  let text = ''
  const pages = Math.min(pdf.numPages, max)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items?.map((it: any) => (it.str ?? '') as string) ?? []
    text += strings.join(' ') + '\n'
  }
  return normalizeText(text)
}

function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}