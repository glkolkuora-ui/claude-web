import { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL ?? ''

export const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
      max: 8,
    })
  : null

export function requirePool(): Pool {
  if (!pool) throw new Error('DATABASE_URL missing')
  return pool
}

export async function pingDb(): Promise<boolean> {
  if (!pool) return false
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}
