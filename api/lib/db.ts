import pg from 'pg';
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL!;
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL');

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10000
});

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows as T[] };
  } finally {
    client.release();
  }
}