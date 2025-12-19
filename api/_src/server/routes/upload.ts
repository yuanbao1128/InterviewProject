import { Hono } from 'hono'
import { supabase, STORAGE_BUCKET } from '../lib/supabase.js'

const r = new Hono()

// 直传 Supabase Storage，返回文件在存储中的路径（私有）
// 注意：该接口仅适合小文件（几 MB 内）。更大的文件建议改为“客户端直传 + 预签名 URL”方案。
r.post('/upload', async (c) => {
  const ct = c.req.header('content-type') || ''
  const clen = c.req.header('content-length') || ''
  console.log('[upload] start', { contentType: ct, contentLength: clen, bucket: STORAGE_BUCKET })

  try {
    // 1) 校验 Content-Type
    if (!ct.toLowerCase().includes('multipart/form-data')) {
      console.warn('[upload] bad content-type', ct)
      return c.json({ ok: false, error: '请使用 multipart/form-data 上传文件（字段名：file）' }, 400)
    }

    // 2) 解析表单（使用标准 formData，避免 parseBody 在不同运行时下的差异）
    const form = await c.req.formData()
    const f = form.get('file') as File | null

    console.log('[upload] form parsed', {
      hasFile: !!f,
      name: f?.name,
      type: (f as any)?.type,
      // File 在某些运行时没有 size 字段，这里容错打印
      size: (f as any)?.size
    })

    if (!f || !(f as any).name) {
      return c.json({ ok: false, error: '缺少文件（字段名应为 file）' }, 400)
    }

    // 3) 生成存储 key（你也可以按用户/日期分目录：resume/2025/12/xxx）
    const origName = f.name || 'unknown.dat'
    const ext = origName.includes('.') ? origName.split('.').pop()!.toLowerCase() : 'dat'
    const key = `resume_${Date.now()}.${ext}`

    // 4) 上传到 Supabase Storage（默认私有桶）
    console.log('[upload] uploading to supabase', { bucket: STORAGE_BUCKET, key })

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(key, f, {
        cacheControl: '3600',
        upsert: false,
        contentType: (f as any).type || undefined
      })

    if (error) {
      console.error('[upload] supabase upload error', { message: error.message, statusCode: (error as any)?.statusCode })
      return c.json({ ok: false, error: `存储失败：${error.message}` }, 500)
    }

    const filePath = data?.path || key // 私有路径（非公开 URL）
    console.log('[upload] stored', { path: filePath })

    // 5) 返回私有路径。若你需要前端可访问，应改为生成签名 URL 或使用公开桶。
    // 结构保持与前端约定一致：{ ok:true, data:{ filePath } }
    return c.json({ ok: true, data: { filePath, bucket: STORAGE_BUCKET, originalName: origName } })
  } catch (e: any) {
    console.error('[upload] error', e)
    return c.json({ ok: false, error: String(e?.message || e) }, 500)
  }
})

export default r