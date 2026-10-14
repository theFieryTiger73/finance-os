import { databaseUrlFromEnv } from '../server/pg.js'

const url = databaseUrlFromEnv()
if (!url) {
  console.log('No database URL set. Using local SQLite (data/finance.db).')
  console.log('Set DATABASE_URL or SUPABASE_DB_URL to target Supabase Postgres.')
  process.exit(0)
}

const isSupabase = /supabase|pooler/i.test(url)
console.log(`Connecting to ${isSupabase ? 'Supabase' : 'Postgres'}...`)

const { createPgDatabase } = await import('../server/pg.js')
const db = await createPgDatabase(url)

const one = await db.prepare('SELECT 1 AS ok').get()
const tables = await db.prepare(
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
).all()
const rls = await db.prepare(
  "SELECT count(*)::int AS total, count(*) FILTER (WHERE c.relrowsecurity)::int AS rls_on " +
  'FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
  "WHERE n.nspname = 'public' AND c.relkind = 'r'"
).get()

console.log('connects:', one?.ok === 1)
console.log('tables:', tables.map(t => t.tablename).join(', ') || '(none)')
console.log('public tables:', rls?.total, '| RLS enabled:', rls?.rls_on)
await db.pool.end()
process.exit(0)
