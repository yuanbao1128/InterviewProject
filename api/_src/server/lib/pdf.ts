// api/src/server/lib/pdf.ts
import { createClient } from '@supabase/supabase-js'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!
const PDF_ENGINE = (process.env.PDF_ENGINE || 'js').toLowerCase()
const PDF_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS || 60000)
const STORAGE_TIMEOUT_MS = Number(process.env.STORAGE_TIMEOUT_MS || 15000)

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

function toU8(input: ArrayBuffer | Uint8Array | any): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  if (input && typeof input === 'object' && typeof (input as ArrayBuffer).byteLength === 'number') {
    return new Uint8Array(input as ArrayBuffer)
  }
  throw new TypeError('Invalid binary input: expected ArrayBuffer/Uint8Array/Buffer')
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/**
 * 推荐方案：通过 createSignedUrl + fetch 下载，避开 SDK.download 在不同运行时的 Blob/流兼容问题。
 * - 带总超时与详细日志
 * - 遇到 404/403/5xx 会抛错并被上层捕获，从而将任务状态写为 error，避免永远 processing
 */
export async function downloadFromStorage(bucket: string, filePath: string, traceId?: string): Promise<ArrayBuffer> {
  const t0 = Date.now()
  const file = (filePath || '').trim()
  if (!file) throw new Error('empty filePath')
  // 额外排查：前后空白与前导斜杠
  const debug = { traceId, bucket, filePath: file, len: file.length, startsWithSlash: file.startsWith('/'), endsWithSpace: /\s$/.test(file) }
  console.log('[pdf] storage.signedUrl.start', JSON.stringify(debug))

  const { data: su, error: suErr } = await withTimeout(
    supabase.storage.from(bucket).createSignedUrl(file, 60),
    STORAGE_TIMEOUT_MS,
    'supabase.createSignedUrl'
  ).catch((e: any) => {
    console.error('[pdf] storage.signedUrl.fetchError', JSON.stringify({ traceId, bucket, filePath: file, err: String(e?.message || e) }))
    throw e
  })

  if (suErr || !su?.signedUrl) {
    console.error('[pdf] storage.signedUrl.error', JSON.stringify({ traceId, bucket, filePath: file, err: String(suErr?.message || suErr) }))
    throw suErr || new Error('createSignedUrl failed')
  }

  const url = su.signedUrl
  let res: Response
  try {
    res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) }), STORAGE_TIMEOUTMS_SAFE(), 'fetch.signedUrl')
  } catch (e: any) {
    console.error('[pdf] http.download.fetchError', JSON.stringify({ traceId, bucket, filePath: file, err: String(e?.name || '') + ': ' + String(e?.message || e) }))
    throw e
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[pdf] http.download.fail', JSON.stringify({ traceId, status: res.status, bucket, filePath: file, body: text.slice(0, 200) }))
    throw new Error(`download http ${res.status}`)
  }

  const ab = await withTimeout(res.arrayBuffer(), STORAGE_TIMEOUT_MS, 'res.arrayBuffer')
  const ms = Date.now() - t0
  console.log('[pdf] storage.download.ok', JSON.stringify({ traceId, bucket, filePath: file, ms, bytes: ab.byteLength }))
  return ab
}

function STORAGE_TIMEOUTMS_SAFE() {
  // Node18 AbortSignal.timeout 已经有，仍保留上层 withTimeout 双保险
  return Math.max(1000, STORAGE_TIMEOUT_MS)
}

export async function pdfArrayBufferToText(ab: ArrayBuffer, traceId?: string): Promise<string> {
  const u8 = toU8(ab)
  const wantPoppler = PDF_ENGINE === 'poppler'
  if (wantPoppler) {
    const ok = await canSpawnPdftotext(traceId)
    if (!ok) {
      console.log('[pdf] engine.fallback', JSON.stringify({ traceId, from: 'poppler', to: 'js', reason: 'pdftotext not found' }))
      return await parseWithUnpdf(u8, traceId)
    }
    try {
      return await parseWithPdfTextExtract(u8, traceId)
    } catch (e: any) {
      console.log('[pdf] engine.poppler.error.fallback', JSON.stringify({ traceId, err: String(e?.message || e) }))
      return await parseWithUnpdf(u8, traceId)
    }
  } else {
    try {
      return await parseWithUnpdf(u8, traceId)
    } catch (e: any) {
      console.log('[pdf] engine.js.error', JSON.stringify({ traceId, err: String(e?.message || e) }))
      const ok = await canSpawnPdftotext(traceId)
      if (ok) {
        console.log('[pdf] engine.fallback', JSON.stringify({ traceId, from: 'js', to: 'poppler' }))
        return await parseWithPdfTextExtract(u8, traceId)
      }
      throw e
    }
  }
}

async function parseWithUnpdf(u8: Uint8Array, traceId?: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'))
  const tmpFile = path.join(tmpDir, 'input.pdf')

  try {
    const tWrite0 = Date.now()
    await fs.writeFile(tmpFile, Buffer.from(u8))
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: u8.byteLength }))

    console.log('[pdf] unpdf.start', JSON.stringify({ traceId, tmpFile }))
    const t0 = Date.now()

    const mod: any = await import('unpdf')
    const extractText:
      | undefined
      | ((buf: Uint8Array, opts?: any) => Promise<{ text?: string } | string>) =
      (mod && typeof mod.extractText === 'function' && mod.extractText) ||
      (mod && mod.default && typeof mod.default.extractText === 'function' && mod.default.extractText)

    if (!extractText) throw new Error('unpdf.extractText not found')

    const controller = new AbortController()
    const to = setTimeout(() => { try { (controller as any).abort?.() } catch {} }, PDF_TIMEOUT_MS)

    try {
      const res = await extractText(u8, { mergePages: true, sortByY: true, signal: (controller as any).signal })
      const rawText = (typeof res === 'string') ? res : (res?.text ?? '')
      const text = normalizeText(rawText)
      console.log('[pdf] unpdf.ok', JSON.stringify({ traceId, ms: Date.now() - t0, chars: text.length }))
      return text
    } finally {
      clearTimeout(to)
    }
  } catch (e: any) {
    console.log('[pdf] unpdf.error', JSON.stringify({ traceId, err: String(e?.message || e) }))
    throw e
  } finally {
    try { await fs.unlink(tmpFile); console.log('[pdf] cleanup.file', JSON.stringify({ traceId, tmpFile })) } catch (e: any) {
      console.log('[pdf] cleanup.file.error', JSON.stringify({ traceId, tmpFile, err: String(e?.message || e) }))
    }
    try { await fs.rm(tmpDir, { recursive: true, force: true }); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })) } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }))
    }
  }
}

async function parseWithPdfTextExtract(u8: Uint8Array, traceId?: string): Promise<string> {
  const mod: any = await import('pdf-text-extract').catch((e: any) => {
    throw new Error(`pdf-text-extract import failed: ${e?.message || e}`)
  })
  const extract = (mod?.default || mod) as any

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'))
  const tmpFile = path.join(tmpDir, 'input.pdf')

  try {
    const tWrite0 = Date.now()
    await fs.writeFile(tmpFile, Buffer.from(u8))
    console.log('[pdf] writeTmp.ok', JSON.stringify({ traceId, tmpDir, tmpFile, ms: Date.now() - tWrite0, bytes: u8.byteLength }))

    console.log('[pdf] extract.start', JSON.stringify({ traceId, tmpFile, engine: 'poppler' }))
    const t0 = Date.now()

    const text = await new Promise<string>((resolve, reject) => {
      let settled = false
      const done = (err?: any, out?: string[] | string) => {
        if (settled) return
        settled = true
        if (err) {
          console.log('[pdf] extract.cb.error', JSON.stringify({ traceId, tmpFile, ms: Date.now() - t0, err: String(err?.message || err) }))
          reject(err)
        } else {
          const arr = Array.isArray(out) ? out : [out || '']
          console.log('[pdf] extract.cb.ok', JSON.stringify({ traceId, tmpFile, ms: Date.now() - t0, pages: arr.length }))
          resolve(arr.join('\n'))
        }
      }

      const to = setTimeout(() => done(new Error(`pdftotext timeout after ${PDF_TIMEOUT_MS}ms`)), PDF_TIMEOUT_MS)
      try {
        console.log('[pdf] extract.invoked', JSON.stringify({ traceId, tmpFile }))
        extract(tmpFile, (err: any, out: string[] | string) => {
          clearTimeout(to)
          done(err, out)
        })
      } catch (e: any) {
        clearTimeout(to)
        done(e)
      }
    })

    const normalized = normalizeText(text)
    console.log('[pdf] extract.normalize.ok', JSON.stringify({ traceId, chars: normalized.length }))
    return normalized
  } catch (e: any) {
    console.log('[pdf] extract.error', JSON.stringify({ traceId, err: String(e?.message || e) }))
    throw e
  } finally {
    try { await fs.unlink(tmpFile); console.log('[pdf] cleanup.file', JSON.stringify({ traceId, tmpFile })) } catch (e: any) {
      console.log('[pdf] cleanup.file.error', JSON.stringify({ traceId, tmpFile, err: String(e?.message || e) }))
    }
    try { await fs.rm(tmpDir, { recursive: true, force: true }); console.log('[pdf] cleanup.dir', JSON.stringify({ traceId, tmpDir })) } catch (e: any) {
      console.log('[pdf] cleanup.dir.error', JSON.stringify({ traceId, tmpDir, err: String(e?.message || e) }))
    }
  }
}

async function canSpawnPdftotext(traceId?: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    try {
      const t0 = Date.now()
      const ps = spawn('pdftotext', ['-v'])
      let resolved = false
      ps.on('error', (err) => {
        if (!resolved) {
          resolved = true
          console.log('[pdf] pdftotext.check.error', JSON.stringify({ traceId, err: String(err?.message || err) }))
          resolve(false)
        }
      })
      ps.on('exit', (code) => {
        if (!resolved) {
          resolved = true
          console.log('[pdf] pdftotext.check.exit', JSON.stringify({ traceId, code, ms: Date.now() - t0 }))
          resolve(code === 0 || code === 1)
        }
      })
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.log('[pdf] pdftotext.check.timeout', JSON.stringify({ traceId }))
          resolve(false)
        }
      }, 3000)
    } catch (e: any) {
      console.log('[pdf] pdftotext.check.throw', JSON.stringify({ traceId, err: String(e?.message || e) }))
      resolve(false)
    }
  })
}

function normalizeText(s: string) {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}