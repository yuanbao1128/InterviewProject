// api/_src/server/workers/parse-resume-consumer.ts
import { pullTaskMessages, deleteMessage, retryLater } from '../lib/mns.js'
import { processTaskOnce } from '../routes/parse-resume-task.js'

// 事件函数入口：导出 handler（阿里云 FC 会调用这个函数）
export async function handler() {
  console.log('[worker] tick')
  try {
    const msgs = await pullTaskMessages(8, 2)
    console.log('[worker] pulled', msgs.length)
    for (const m of msgs) {
      const taskId = m.body?.taskId
      if (!taskId) {
        console.log('[worker] skip invalid message')
        await deleteMessage(m.handle)
        continue
      }
      try {
        await processTaskOnce(taskId)
        await deleteMessage(m.handle)
        console.log('[worker] done', taskId)
      } catch (e: any) {
        console.error('[worker] process fail', taskId, e?.message || e)
        await retryLater(m.handle)
      }
    }
  } catch (e: any) {
    console.error('[worker] tick fail', e?.message || e)
  }
  // 事件函数无需返回 HTTP 响应
  return { ok: true }
}