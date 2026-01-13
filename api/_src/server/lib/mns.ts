// api/_src/server/lib/mns.ts
import { MQClient } from '@aliyunmq/mq-http-sdk'

const MNS_ENDPOINT = process.env.MNS_ENDPOINT || ''        // 例：https://<uid>.mqrest.cn-hangzhou.aliyuncs.com
const MNS_ACCESS_KEY = process.env.MNS_ACCESS_KEY || ''
const MNS_SECRET_KEY = process.env.MNS_SECRET_KEY || ''
const MNS_INSTANCE_ID = process.env.MNS_INSTANCE_ID || ''  // 普通版可为空，RocketMQ5 专用
const MNS_QUEUE = process.env.MNS_QUEUE || 'resume-parse-queue'

if (!MNS_ENDPOINT || !MNS_ACCESS_KEY || !MNS_SECRET_KEY) {
  throw new Error('Missing MNS env: MNS_ENDPOINT/MNS_ACCESS_KEY/MNS_SECRET_KEY')
}

const client = new MQClient(MNS_ENDPOINT, MNS_ACCESS_KEY, MNS_SECRET_KEY)

export async function sendTaskMessage(taskId: string) {
  const producer = client.getTransProducer(MNS_INSTANCE_ID, MNS_QUEUE)
  const msg = JSON.stringify({ taskId, ts: Date.now() })
  // 简化：直接普通消息
  const pub = client.getProducer(MNS_INSTANCE_ID, MNS_QUEUE)
  const ret = await pub.publishMessage(msg)
  return ret
}

export type TaskMsg = { taskId: string; ts?: number }

export async function pullTaskMessages(max = 8, waitSeconds = 2): Promise<{ handle: string; body: TaskMsg }[]> {
  const consumer = client.getConsumer(MNS_INSTANCE_ID, MNS_QUEUE)
  const res = await consumer.consumeMessage(max, waitSeconds)
  const list: { handle: string; body: TaskMsg }[] = []
  for (const m of res) {
    try {
      const body = JSON.parse(m.MessageBody)
      list.push({ handle: m.ReceiptHandle, body })
    } catch {
      list.push({ handle: m.ReceiptHandle, body: { taskId: '' } })
    }
  }
  return list
}

export async function deleteMessage(handle: string) {
  const consumer = client.getConsumer(MNS_INSTANCE_ID, MNS_QUEUE)
  await consumer.ackMessage(handle)
}

export async function retryLater(handle: string) {
  // 简化：不改变可见性，交给 MNS 的重投/超时机制，或者你可以在这里修改可见性
  // const consumer = client.getConsumer(MNS_INSTANCE_ID, MNS_QUEUE)
  // await consumer.changeMessageVisibility(handle, 10)
  return
}