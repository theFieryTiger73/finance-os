import fs from 'fs'
import path from 'path'
import { db, dataDir, backupsDir, dbPath, LIVE_TX } from './db.js'
import { isoDate } from './money.js'

const TABLES = [
  'accounts', 'businesses', 'categories', 'transactions', 'budgets', 'debts',
  'goals', 'recurring_transactions', 'attachments', 'financial_snapshots',
  'notifications', 'allocation_rules'
]
export function audit(userId, action, entity, entityId, before = null, after = null) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, before_json, after_json) VALUES (?,?,?,?,?,?)')
    .run(userId || null, action, entity, entityId || null, before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '')
}

export function checkpoint() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
}

export function backupNow(reason = 'auto') {
  checkpoint()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(backupsDir, `finance-${stamp}-${reason}.db`)
  fs.copyFileSync(dbPath, dest)
  for (const ext of ['-wal', '-shm']) {
    const src = dbPath + ext
    if (fs.existsSync(src)) fs.copyFileSync(src, dest + ext)
  }
  return dest
}

export function maybeAutoBackup() {
  const marker = path.join(dataDir, '.last-backup')
  const today = isoDate()
  try {
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === today) return null
  } catch { /* backup anyway */ }
  const dest = backupNow('daily')
  fs.writeFileSync(marker, today)
  return dest
}

export function listBackups() {
  return fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(backupsDir, f))
      return { name: f, size: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function exportUser(userId) {
  const user = db.prepare('SELECT id, first_name, last_name, email, country, currency, language, theme, onboarding_completed, onboarding_step, emergency_fund_target, min_liquidity, created_at, updated_at FROM users WHERE id=?').get(userId)
  const data = {}
  for (const table of TABLES) {
    data[table] = db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(userId)
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    data
  }
}

export function restoreUser(userId, payload) {
  if (!payload || payload.version !== 1 || !payload.data) throw new Error('Invalid backup file')
  const src = payload.data
  db.exec('BEGIN')
  try {
    for (const table of TABLES) {
      const rows = Array.isArray(src[table]) ? src[table] : []
      for (const row of rows) {
        const mine = db.prepare(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).get(row.id, userId)
        if (mine) continue
        const cols = Object.keys(row).filter(k => k !== 'user_id')
        const idFree = row.id != null && !db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id)
        const useCols = idFree ? cols : cols.filter(k => k !== 'id')
        if (!useCols.length) continue
        const placeholders = useCols.map(() => '?').join(',')
        db.prepare(`INSERT INTO ${table} (user_id, ${useCols.join(',')}) VALUES (?,${placeholders})`)
          .run(userId, ...useCols.map(c => row[c]))
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  audit(userId, 'restore', 'user', userId, null, { tables: TABLES })
  backupNow('after-restore')
}

export function integrityOk() {
  const row = db.prepare('PRAGMA integrity_check').get()
  const value = row?.integrity_check || Object.values(row || {})[0]
  return value === 'ok'
}

export { LIVE_TX }
