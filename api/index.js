import { applyOriginalApiPath } from '../server/vercel-path.js'

let appPromise

const HINTS = {
  DB_URL_MISSING: 'Set DATABASE_URL (or SUPABASE_DB_URL) to the PostgreSQL connection string for this environment, then redeploy.',
  SQLITE_UNAVAILABLE: 'This runtime has no node:sqlite. A PostgreSQL connection URL is required on Vercel.',
  ENOTFOUND: 'Database host did not resolve. For Supabase on Vercel use the Supavisor pooler host (session mode, port 5432), not the direct db.<ref>.supabase.co host.',
  EAI_AGAIN: 'Temporary DNS failure resolving the database host. Retry, or use the Supabase pooler host.',
  ECONNREFUSED: 'Database refused the connection. Check host, port and that the database accepts remote connections.',
  ETIMEDOUT: 'Database connection timed out. Use the Supabase pooler connection string and verify network access.',
  '28P01': 'Database authentication failed. Check the password inside the connection URL (URL-encode special characters).',
  '28000': 'Database rejected the login. Check the database user and password.',
  '3D000': 'The database named in the connection URL does not exist.',
  '42501': 'Database user lacks permission for the schema. Use the database owner/role that ran the migration.',
  '42P01': 'Database schema is missing. Run supabase/migrations/0001_finance_os_init.sql in the Supabase SQL editor.',
  DATABASE_INIT_FAILED: 'Database initialization failed. Check the deployment logs for details.'
}

function errorCode(err) {
  const code = String((err && err.code) || '').trim()
  if (code) return code
  const message = String((err && err.message) || '')
  if (/node:sqlite/i.test(message)) return 'SQLITE_UNAVAILABLE'
  return 'DATABASE_INIT_FAILED'
}

function loadApp() {
  return import('../server/index.js').then(mod => mod.createApp())
}

export default async function handler(req, res) {
  try {
    if (!appPromise) {
      appPromise = loadApp().catch(err => {
        appPromise = undefined
        throw err
      })
    }
    const app = await appPromise
    applyOriginalApiPath(req)
    return app(req, res)
  } catch (err) {
    const code = errorCode(err)
    console.error(`finance-os: server initialization failed [${code}]: ${err && err.message ? err.message : err}`)
    if (!res.headersSent) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
    }
    res.end(JSON.stringify({
      error: 'Server initialization failed',
      code,
      hint: HINTS[code] || HINTS.DATABASE_INIT_FAILED,
      ...(err && err.dbSource ? { source: err.dbSource } : {}),
      ...(err && err.dbHost ? { host: err.dbHost } : {})
    }))
  }
}
