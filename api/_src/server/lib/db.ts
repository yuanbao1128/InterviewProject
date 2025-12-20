import pg from 'pg'
const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL || ''
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL')

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10000
})

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
  const client = await pool.connect()
  try {
    const res = await client.query(text, params)
    return { rows: res.rows as T[], rowCount: (res as any).rowCount ?? 0 }
  } finally {
    client.release()
  }
}

// 统一检查写库命中行数
export function ensureDbWriteOk(res: { rowCount: number } | any, label: string) {
  if (!res) throw new Error(`${label}: empty db result`)
  const rc = typeof res.rowCount === 'number' ? res.rowCount : -1
  if (rc <= 0) throw new Error(`${label}: affected 0 rows`)
}