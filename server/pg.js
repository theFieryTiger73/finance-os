import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import { PG_SCHEMA } from './schema.pg.js'

const { Pool } = pg
const txStore = new AsyncLocalStorage()

export function databaseUrlFromEnv() {
  const raw = process.env.USER_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || ''
  return String(raw).trim()
}

export function sqliteToPg(sql) {
  let s = String(sql)
  const ignore = /\bINSERT OR IGNORE INTO\b/i.test(s)
  s = s.replace(/\bINSERT OR IGNORE INTO\b/gi, 'INSERT INTO')
  s = s.replace(/\bMAX\s*\(\s*0\s*,/gi, 'GREATEST(0,')
  s = s.replace(/\bdatetime\('now'\)/gi, "to_char(timezone('utc', now()), 'YYYY-MM-DD HH24:MI:SS')")
  s = s.replace(/\bdate\('now',\s*'([+-]?\d+)\s+day'\)/gi, (_m, n) => `to_char((timezone('utc', now()) + interval '${Number(n)} day'), 'YYYY-MM-DD')`)
  s = s.replace(/\bdate\('now'\)/gi, "to_char(timezone('utc', now()), 'YYYY-MM-DD')")
  s = s.replace(/\bsubstr\(([^,]+),\s*1,\s*10\)/gi, 'substring($1 from 1 for 10)')
  s = s.replace(/\bexcluded\./gi, 'EXCLUDED.')
  if (ignore && !/ON CONFLICT/i.test(s)) {
    s = s.replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING')
  }
  let i = 0
  s = s.replace(/\?/g, () => `$${++i}`)
  return s
}

class PgStatement {
  constructor(pool, sql) {
    this.pool = pool
    this.sql = sql
    this.pgSql = sqliteToPg(sql)
  }

  runner() {
    return txStore.getStore() || this.pool
  }

  async get(...params) {
    const r = await this.runner().query(this.pgSql, params)
    return r.rows[0]
  }

  async all(...params) {
    const r = await this.runner().query(this.pgSql, params)
    return r.rows
  }

  async run(...params) {
    const returning = /\bINSERT\s+INTO\b/i.test(this.sql) && !/\bRETURNING\b/i.test(this.pgSql)
    const sql = returning ? `${this.pgSql} RETURNING id` : this.pgSql
    const r = await this.runner().query(sql, params)
    const id = r.rows[0]?.id
    return {
      lastInsertRowid: id == null ? 0 : Number(id),
      changes: r.rowCount || 0
    }
  }
}

export async function createPgDatabase(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: /supabase|amazonaws|neon|sslmode=require/i.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    max: process.env.VERCEL ? 1 : 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000
  })
  await pool.query(PG_SCHEMA)

  return {
    dialect: 'postgres',
    pool,
    prepare(sql) {
      return new PgStatement(pool, sql)
    },
    async exec(sql) {
      const t = String(sql).trim().toUpperCase()
      if (t === 'BEGIN') {
        if (txStore.getStore()) return
        const client = await pool.connect()
        await client.query('BEGIN')
        txStore.enterWith(client)
        return
      }
      if (t === 'COMMIT') {
        const client = txStore.getStore()
        if (!client) return
        try { await client.query('COMMIT') } finally { client.release(); txStore.enterWith(undefined) }
        return
      }
      if (t === 'ROLLBACK') {
        const client = txStore.getStore()
        if (!client) return
        try { await client.query('ROLLBACK') } finally { client.release(); txStore.enterWith(undefined) }
        return
      }
      if (/^PRAGMA\b/i.test(sql)) return
      await (txStore.getStore() || pool).query(sqliteToPg(sql))
    }
  }
}
