import express from 'express'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import multer from 'multer'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'
import { db, uploadsDir, LIVE_TX } from './db.js'
import { audit, backupNow, maybeAutoBackup, listBackups, exportUser, restoreUser, integrityOk } from './persist.js'
import { authMiddleware, publicUser, register, login, signToken, createResetToken, resetPassword, jwtConfigured } from './auth.js'
import {
  accountBalance, allAccountBalances, syncDebtBalance, syncAllDebts, debtBalance, netWorth, recordSnapshot,
  periodRange, periodStats, cashFlowSeries, expenseDistribution, financialHealthScore,
  budgetPerformance, nextAction, coachInsights, affordability, applyAllocation, businessSummary,
  round2, txFilter, ACCOUNT_TYPES, TX_TYPES
} from './finance.js'
import { parseMoney, asId, sameId, isoDate, isIsoDate, fromCents, toCents } from './money.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5173)
const isProd = process.env.NODE_ENV === 'production'

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(uploadsDir, 'logos')),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
})
const attachStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(uploadsDir, 'attachments')),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
})
const imageFilter = (_req, file, cb) => {
  const ok = /png|jpe?g|webp|svg\+xml|svg|pdf/i.test(file.mimetype) || /\.(png|jpe?g|webp|svg|pdf)$/i.test(file.originalname)
  cb(ok ? null : new Error('Only PNG, JPG, WebP, SVG or PDF files are allowed'), ok)
}
const uploadLogo = multer({ storage: logoStorage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } })
const uploadAttach = multer({ storage: attachStorage, fileFilter: imageFilter, limits: { fileSize: 8 * 1024 * 1024 } })

const OWN_TABLES = new Set([
  'accounts', 'businesses', 'categories', 'transactions', 'budgets', 'debts',
  'goals', 'recurring_transactions', 'allocation_rules', 'attachments', 'notifications'
])

async function own(table, userId, id) {
  if (!OWN_TABLES.has(table)) return null
  const nid = asId(id)
  if (!nid) return null
  return await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(nid, userId)
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags.join(',')
  return String(tags || '').slice(0, 200)
}

function emptyToNull(v) {
  if (v == null || v === '' || v === 'undefined' || v === 'null') return null
  return v
}

function clientKey(req) {
  return String(req.headers['idempotency-key'] || req.body?.clientId || '').trim().slice(0, 80) || null
}

async function replayIdempotent(req, table) {
  const key = clientKey(req)
  if (!key) return null
  const hit = await db.prepare('SELECT * FROM idempotency_keys WHERE user_id=? AND key=?').get(req.user.id, key)
  if (hit?.entity_id) return await own(hit.entity || table, req.user.id, hit.entity_id)
  try {
    return await db.prepare(`SELECT * FROM ${table} WHERE user_id=? AND client_id=?`).get(req.user.id, key) || null
  } catch {
    return null
  }
}

async function rememberIdempotent(req, table, id) {
  const key = clientKey(req)
  if (!key || !id) return
  await db.prepare('INSERT OR IGNORE INTO idempotency_keys (user_id, key, method, path, entity, entity_id) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, key, req.method, req.originalUrl || req.path, table, id)
}

async function refreshNotifications(userId) {
  await syncAllDebts(userId)
  const today = isoDate()
  const insert = await db.prepare('INSERT INTO notifications (user_id, type, title, message) VALUES (?,?,?,?)')
  const exists = await db.prepare('SELECT id FROM notifications WHERE user_id=? AND title=? AND substr(created_at,1,10)=?')
  const debts = await db.prepare("SELECT * FROM debts WHERE user_id=? AND status IN ('active','overdue')").all(userId)
  for (const d of debts) {
    if (d.status === 'overdue') {
      const title = `Overdue: ${d.creditor}`
      if (!(await exists.get(userId, title, today))) await insert.run(userId, 'critical', title, `${d.creditor} is overdue. Remaining ${fromCents(toCents(d.current_balance))}.`)
    } else if (d.due_date && d.due_date <= today) {
      const title = `Due today: ${d.creditor}`
      if (!(await exists.get(userId, title, today))) await insert.run(userId, 'warning', title, `${d.creditor} is due ${d.due_date}.`)
    }
  }
  const budgets = await budgetPerformance(userId, periodRange('month'))
  for (const b of budgets) {
    if (b.status === 'exceeded') {
      const title = `Budget exceeded: ${b.name}`
      if (!(await exists.get(userId, title, today))) await insert.run(userId, 'warning', title, `${b.name} is over budget this period.`)
    }
  }
}

export async function createApp() {
  await maybeAutoBackup()
  const app = express()
  app.use(express.json({ limit: '8mb' }))

  const api = express.Router()

  api.post('/auth/register', async (req, res) => {
    try {
      if (!jwtConfigured()) return res.status(503).json({ error: 'Sign-in is unavailable. Server configuration is incomplete.' })
      const user = await register(req.body)
      res.json({ token: signToken(user), user: publicUser(user) })
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.post('/auth/login', async (req, res) => {
    try {
      if (!jwtConfigured()) return res.status(503).json({ error: 'Sign-in is unavailable. Server configuration is incomplete.' })
      const user = await login(req.body.email, req.body.password)
      res.json({ token: signToken(user), user: publicUser(user) })
    } catch (e) {
      const invalid = e.message === 'Invalid email or password'
      res.status(invalid ? 401 : 400).json({ error: e.message })
    }
  })

  api.post('/auth/forgot', async (req, res) => {
    const result = await createResetToken(req.body.email)
    if (!result) return res.json({ ok: true })
    res.json({ ok: true, resetToken: result.token, hint: 'In production this is emailed. Use the token on the reset page.' })
  })

  api.post('/auth/reset', async (req, res) => {
    try {
      const user = await resetPassword(req.body.token, req.body.password)
      res.json({ token: signToken(user), user: publicUser(user) })
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.use(authMiddleware)

  api.get('/me', async (req, res) => res.json(publicUser(req.user)))

  api.put('/me', async (req, res) => {
    const u = req.user
    const first = req.body.firstName ?? u.first_name
    const last = req.body.lastName ?? u.last_name
    const country = req.body.country ?? u.country
    const currency = req.body.currency ?? u.currency
    const language = req.body.language ?? u.language
    const theme = req.body.theme ?? u.theme
    const emergency = req.body.emergencyFundTarget ?? u.emergency_fund_target
    const minLiq = req.body.minLiquidity ?? u.min_liquidity
    await db.prepare(`UPDATE users SET first_name=?, last_name=?, country=?, currency=?, language=?, theme=?,
      emergency_fund_target=?, min_liquidity=?, updated_at=datetime('now') WHERE id=?`)
      .run(first, last, country, currency, language, theme, emergency, minLiq, u.id)
    res.json(publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(u.id)))
  })

  api.put('/me/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' })
    if (!bcrypt.compareSync(currentPassword || '', req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' })
    await db.prepare("UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?").run(bcrypt.hashSync(newPassword, 10), req.user.id)
    res.json({ ok: true })
  })

  api.put('/onboarding', async (req, res) => {
    const step = Number(req.body.step ?? req.user.onboarding_step)
    const completed = req.body.completed ? 1 : req.user.onboarding_completed
    if (req.body.firstName || req.body.currency || req.body.country) {
      await db.prepare("UPDATE users SET first_name=COALESCE(?, first_name), last_name=COALESCE(?, last_name), currency=COALESCE(?, currency), country=COALESCE(?, country), onboarding_step=?, onboarding_completed=?, updated_at=datetime('now') WHERE id=?")
        .run(req.body.firstName || null, req.body.lastName || null, req.body.currency || null, req.body.country || null, step, completed ? 1 : 0, req.user.id)
    } else {
      await db.prepare("UPDATE users SET onboarding_step=?, onboarding_completed=?, updated_at=datetime('now') WHERE id=?")
        .run(step, completed ? 1 : 0, req.user.id)
    }
    res.json(publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)))
  })

  api.get('/accounts', async (req, res) => {
    const includeArchived = req.query.includeArchived === '1'
    res.json(await allAccountBalances(req.user.id, { includeArchived }))
  })

  api.post('/accounts', async (req, res) => {
    try {
      const existing = await replayIdempotent(req, 'accounts')
      if (existing) return res.json({ ...existing, balance: await accountBalance(req.user.id, existing.id) })
      const { name, type, provider, currency, initialBalance, icon, color, notes, status, businessId } = req.body
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name and type are required' })
      if (!ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' })
      const biz = emptyToNull(businessId)
      if (biz && !(await own('businesses', req.user.id, biz))) return res.status(400).json({ error: 'Business not found' })
      const initial = parseMoney(initialBalance ?? 0, { allowZero: true, allowNegative: type === 'credit_card', field: 'Initial balance' })
      const info = await db.prepare(`INSERT INTO accounts (user_id, name, type, provider, currency, initial_balance, icon, color, notes, status, business_id, client_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, String(name).trim(), type, provider || '', currency || req.user.currency, initial, icon || 'wallet', color || '#2E90FA', notes || '', status === 'archived' ? 'archived' : 'active', asId(biz), clientKey(req))
      await recordSnapshot(req.user.id)
      const a = await own('accounts', req.user.id, info.lastInsertRowid)
      await rememberIdempotent(req, 'accounts', a.id)
      res.json({ ...a, balance: await accountBalance(req.user.id, a.id) })
    } catch (e) {
      const replay = await replayIdempotent(req, 'accounts')
      if (replay) return res.json({ ...replay, balance: await accountBalance(req.user.id, replay.id) })
      res.status(400).json({ error: e.message })
    }
  })

  api.put('/accounts/:id', async (req, res) => {
    try {
      const a = await own('accounts', req.user.id, req.params.id)
      if (!a) return res.status(404).json({ error: 'Account not found' })
      const b = req.body
      const type = b.type ?? a.type
      if (!ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' })
      const biz = b.businessId === undefined ? a.business_id : emptyToNull(b.businessId)
      if (biz && !(await own('businesses', req.user.id, biz))) return res.status(400).json({ error: 'Business not found' })
      const initial = b.initialBalance === undefined ? a.initial_balance : parseMoney(b.initialBalance, { allowZero: true, allowNegative: type === 'credit_card', field: 'Initial balance' })
      await db.prepare(`UPDATE accounts SET name=?, type=?, provider=?, currency=?, initial_balance=?, icon=?, color=?, notes=?, status=?, business_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
        .run(b.name ?? a.name, type, b.provider ?? a.provider, b.currency ?? a.currency, initial, b.icon ?? a.icon, b.color ?? a.color, b.notes ?? a.notes, b.status ?? a.status, asId(biz), a.id, req.user.id)
      await recordSnapshot(req.user.id)
      const u = await own('accounts', req.user.id, a.id)
      res.json({ ...u, balance: await accountBalance(req.user.id, u.id) })
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.post('/accounts/:id/archive', async (req, res) => {
    const a = await own('accounts', req.user.id, req.params.id)
    if (!a) return res.status(404).json({ error: 'Account not found' })
    await db.prepare("UPDATE accounts SET status='archived', updated_at=datetime('now') WHERE id=? AND user_id=?").run(a.id, req.user.id)
    res.json({ ok: true })
  })

  api.get('/accounts/:id/transactions', async (req, res) => {
    const a = await own('accounts', req.user.id, req.params.id)
    if (!a) return res.status(404).json({ error: 'Account not found' })
    const rows = await db.prepare(`SELECT * FROM transactions WHERE user_id=? AND (account_id=? OR to_account_id=?) AND ${LIVE_TX} ORDER BY date DESC, id DESC`).all(req.user.id, a.id, a.id)
    res.json({ account: { ...a, balance: await accountBalance(req.user.id, a.id) }, transactions: rows })
  })

  api.get('/businesses', async (req, res) => {
    const rows = await db.prepare('SELECT * FROM businesses WHERE user_id=? ORDER BY name').all(req.user.id)
    const month = periodRange(req.query.period || 'month', req.query.from, req.query.to)
    const out = []
    for (const b of rows) {
      const s = await periodStats(req.user.id, { ...month, businessId: b.id })
      out.push({ ...b, revenue: s.businessRevenue, expenses: s.businessExpenses, profit: s.businessProfit })
    }
    res.json(out)
  })

  api.post('/businesses', uploadLogo.single('logo'), async (req, res) => {
    const existing = await replayIdempotent(req, 'businesses')
    if (existing) return res.json(existing)
    const { name, description, type, brandColor, currency, status, notes } = req.body
    if (!name) return res.status(400).json({ error: 'Name is required' })
    const logo = req.file ? `/api/files/logos/${req.file.filename}` : ''
    const info = await db.prepare(`INSERT INTO businesses (user_id, name, logo, description, type, brand_color, currency, status, notes, client_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(req.user.id, name, logo, description || '', type || 'other', brandColor || '#7A5AF8', currency || req.user.currency, status || 'active', notes || '', clientKey(req))
    const created = await own('businesses', req.user.id, info.lastInsertRowid)
    await rememberIdempotent(req, 'businesses', created.id)
    res.json(created)
  })

  api.put('/businesses/:id', uploadLogo.single('logo'), async (req, res) => {
    const b = await own('businesses', req.user.id, req.params.id)
    if (!b) return res.status(404).json({ error: 'Business not found' })
    const body = req.body
    const logo = req.file ? `/api/files/logos/${req.file.filename}` : (body.logo === '' ? '' : b.logo)
    await db.prepare(`UPDATE businesses SET name=?, logo=?, description=?, type=?, brand_color=?, currency=?, status=?, notes=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
      .run(body.name ?? b.name, logo, body.description ?? b.description, body.type ?? b.type, body.brandColor ?? b.brand_color, body.currency ?? b.currency, body.status ?? b.status, body.notes ?? b.notes, b.id, req.user.id)
    res.json(await own('businesses', req.user.id, b.id))
  })

  api.get('/businesses/:id', async (req, res) => {
    const range = periodRange(req.query.period || 'month', req.query.from, req.query.to)
    const s = await businessSummary(req.user.id, Number(req.params.id), range)
    if (!s) return res.status(404).json({ error: 'Business not found' })
    res.json(s)
  })

  api.get('/categories', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY name').all(req.user.id))
  })

  api.post('/categories', async (req, res) => {
    const { name, icon, color, type, scope, businessId, parentId } = req.body
    if (!name || !type) return res.status(400).json({ error: 'Name and type are required' })
    const info = await db.prepare(`INSERT INTO categories (user_id, name, icon, color, type, scope, business_id, parent_id) VALUES (?,?,?,?,?,?,?,?)`)
      .run(req.user.id, name, icon || 'tag', color || '#2E90FA', type, scope || 'personal', businessId || null, parentId || null)
    res.json(await own('categories', req.user.id, info.lastInsertRowid))
  })

  api.put('/categories/:id', async (req, res) => {
    const c = await own('categories', req.user.id, req.params.id)
    if (!c) return res.status(404).json({ error: 'Category not found' })
    const b = req.body
    await db.prepare(`UPDATE categories SET name=?, icon=?, color=?, type=?, scope=?, business_id=?, parent_id=?, status=? WHERE id=? AND user_id=?`)
      .run(b.name ?? c.name, b.icon ?? c.icon, b.color ?? c.color, b.type ?? c.type, b.scope ?? c.scope, b.businessId === undefined ? c.business_id : b.businessId, b.parentId === undefined ? c.parent_id : b.parentId, b.status ?? c.status, c.id, req.user.id)
    res.json(await own('categories', req.user.id, c.id))
  })

  api.post('/categories/:id/archive', async (req, res) => {
    const c = await own('categories', req.user.id, req.params.id)
    if (!c) return res.status(404).json({ error: 'Category not found' })
    await db.prepare("UPDATE categories SET status='archived' WHERE id=? AND user_id=?").run(c.id, req.user.id)
    res.json({ ok: true })
  })

  async function validateTx(body, userId, { excludeTxId } = {}) {
    const type = body.type
    if (!type || !TX_TYPES.includes(type)) throw new Error('Type is required')
    if (!isIsoDate(body.date)) throw new Error('Date is required (YYYY-MM-DD)')
    const amount = parseMoney(body.amount, { allowNegative: type === 'adjustment', field: 'Amount' })
    const accountId = emptyToNull(body.accountId)
    const toAccountId = emptyToNull(body.toAccountId)
    const businessId = emptyToNull(body.businessId)
    const debtId = emptyToNull(body.debtId)
    const goalId = emptyToNull(body.goalId)
    const categoryId = emptyToNull(body.categoryId)
    if (type === 'transfer' || type === 'investment') {
      if (!accountId || !toAccountId) throw new Error('Transfer requires from and to accounts')
      if (sameId(accountId, toAccountId)) throw new Error('Cannot transfer to the same account')
    } else if (type !== 'adjustment') {
      if (!accountId) throw new Error('Account is required')
    }
    if (accountId && !(await own('accounts', userId, accountId))) throw new Error('Account not found')
    if (toAccountId && !(await own('accounts', userId, toAccountId))) throw new Error('Account not found')
    if (businessId && !(await own('businesses', userId, businessId))) throw new Error('Business not found')
    if (categoryId && !(await own('categories', userId, categoryId))) throw new Error('Category not found')
    if (goalId && !(await own('goals', userId, goalId))) throw new Error('Goal not found')
    if (debtId && !(await own('debts', userId, debtId))) throw new Error('Debt not found')
    if (type === 'debt_payment') {
      if (!debtId) throw new Error('Debt payment requires a debt')
      let remaining = toCents(await debtBalance(userId, debtId))
      if (excludeTxId) {
        const prev = await own('transactions', userId, excludeTxId)
        if (prev && prev.type === 'debt_payment' && sameId(prev.debt_id, debtId)) remaining += toCents(prev.amount)
      }
      if (toCents(amount) > remaining) throw new Error('Payment cannot exceed remaining debt')
    }
    return { amount, accountId: asId(accountId), toAccountId: asId(toAccountId), businessId: asId(businessId), debtId: asId(debtId), goalId: asId(goalId), categoryId: asId(categoryId) }
  }

  api.get('/transactions', async (req, res) => {
    const { q, type, accountId, businessId, categoryId, from, to, sort } = req.query
    let sql = `SELECT * FROM transactions WHERE user_id=? AND ${req.query.includeVoided === '1' ? '1=1' : LIVE_TX}`
    const params = [req.user.id]
    if (type) { sql += ' AND type=?'; params.push(type) }
    if (accountId) { sql += ' AND (account_id=? OR to_account_id=?)'; params.push(accountId, accountId) }
    if (businessId === 'personal') sql += ' AND business_id IS NULL'
    else if (businessId && businessId !== 'all') { sql += ' AND business_id=?'; params.push(businessId) }
    if (categoryId) { sql += ' AND category_id=?'; params.push(categoryId) }
    if (from) { sql += ' AND date>=?'; params.push(from) }
    if (to) { sql += ' AND date<=?'; params.push(to) }
    if (q) { sql += ' AND (description LIKE ? OR notes LIKE ? OR tags LIKE ?)'; const like = `%${q}%`; params.push(like, like, like) }
    sql += sort === 'amount' ? ' ORDER BY amount DESC, date DESC' : ' ORDER BY date DESC, id DESC'
    res.json(await db.prepare(sql).all(...params))
  })

  api.post('/transactions', uploadAttach.single('attachment'), async (req, res) => {
    try {
      const existing = await replayIdempotent(req, 'transactions')
      if (existing) return res.json(existing)
      const b = req.body
      const v = await validateTx(b, req.user.id)
      const attachment = req.file ? `/api/files/attachments/${req.file.filename}` : ''
      const cid = clientKey(req)
      const info = await db.prepare(`INSERT INTO transactions (user_id, amount, date, type, account_id, to_account_id, category_id, business_id, debt_id, goal_id, description, notes, tags, attachment, recurring_id, client_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, v.amount, b.date, b.type, v.accountId, v.toAccountId, v.categoryId, v.businessId, v.debtId, v.goalId, b.description || '', b.notes || '', parseTags(b.tags), attachment, asId(emptyToNull(b.recurringId)), cid)
      if (req.file) {
        await db.prepare('INSERT INTO attachments (user_id, transaction_id, filename, path, mime) VALUES (?,?,?,?,?)')
          .run(req.user.id, info.lastInsertRowid, req.file.filename, attachment, req.file.mimetype || '')
      }
      if (v.debtId) await syncDebtBalance(req.user.id, v.debtId)
      await applyGoalDelta(req.user.id, v.goalId, b.type, v.amount)
      await recordSnapshot(req.user.id)
      const created = await own('transactions', req.user.id, info.lastInsertRowid)
      await rememberIdempotent(req, 'transactions', created.id)
      await audit(req.user.id, 'create', 'transaction', created.id, null, created)
      res.json(created)
    } catch (e) {
      const replay = await replayIdempotent(req, 'transactions')
      if (replay) return res.json(replay)
      res.status(400).json({ error: e.message })
    }
  })

  api.put('/transactions/:id', uploadAttach.single('attachment'), async (req, res) => {
    try {
      const t = await own('transactions', req.user.id, req.params.id)
      if (!t) return res.status(404).json({ error: 'Transaction not found' })
      if (t.voided_at) return res.status(400).json({ error: 'Restore this transaction before editing' })
      const b = req.body
      const merged = {
        type: b.type ?? t.type,
        amount: b.amount ?? t.amount,
        date: b.date ?? t.date,
        accountId: b.accountId ?? t.account_id,
        toAccountId: b.toAccountId ?? t.to_account_id,
        businessId: b.businessId === undefined ? t.business_id : b.businessId,
        debtId: b.debtId === undefined ? t.debt_id : b.debtId,
        goalId: b.goalId === undefined ? t.goal_id : b.goalId,
        categoryId: b.categoryId === undefined ? t.category_id : b.categoryId
      }
      const v = await validateTx(merged, req.user.id, { excludeTxId: t.id })
      const attachment = req.file ? `/api/files/attachments/${req.file.filename}` : (b.attachment === '' ? '' : t.attachment)
      await db.prepare(`UPDATE transactions SET amount=?, date=?, type=?, account_id=?, to_account_id=?, category_id=?, business_id=?, debt_id=?, goal_id=?, description=?, notes=?, tags=?, attachment=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
        .run(v.amount, merged.date, merged.type, v.accountId, v.toAccountId, v.categoryId, v.businessId, v.debtId, v.goalId, b.description ?? t.description, b.notes ?? t.notes, parseTags(b.tags ?? t.tags), attachment, t.id, req.user.id)
      if (req.file) {
        await db.prepare('INSERT INTO attachments (user_id, transaction_id, filename, path, mime) VALUES (?,?,?,?,?)')
          .run(req.user.id, t.id, req.file.filename, attachment, req.file.mimetype || '')
      }
      await applyGoalDelta(req.user.id, t.goal_id, t.type, -Number(t.amount))
      await applyGoalDelta(req.user.id, v.goalId, merged.type, v.amount)
      const debtIds = new Set([t.debt_id, v.debtId].filter(Boolean))
      for (const id of debtIds) await syncDebtBalance(req.user.id, id)
      await recordSnapshot(req.user.id)
      res.json(await own('transactions', req.user.id, t.id))
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.delete('/transactions/:id', async (req, res) => {
    const t = await own('transactions', req.user.id, req.params.id)
    if (!t) return res.status(404).json({ error: 'Transaction not found' })
    if (t.voided_at) return res.json({ ok: true, alreadyVoided: true })
    await db.prepare("UPDATE transactions SET voided_at=datetime('now'), void_reason=?, updated_at=datetime('now') WHERE id=? AND user_id=?")
      .run(String(req.body?.reason || 'voided by user').slice(0, 200), t.id, req.user.id)
    if (t.debt_id) await syncDebtBalance(req.user.id, t.debt_id)
    await applyGoalDelta(req.user.id, t.goal_id, t.type, -Number(t.amount))
    await recordSnapshot(req.user.id)
    await audit(req.user.id, 'void', 'transaction', t.id, t, { reason: req.body?.reason || 'voided by user' })
    res.json({ ok: true, voided: true })
  })

  api.post('/transactions/:id/restore', async (req, res) => {
    const t = await own('transactions', req.user.id, req.params.id)
    if (!t) return res.status(404).json({ error: 'Transaction not found' })
    if (!t.voided_at) return res.json(t)
    try {
      await validateTx({
        type: t.type, amount: t.amount, date: t.date,
        accountId: t.account_id, toAccountId: t.to_account_id, businessId: t.business_id,
        debtId: t.debt_id, goalId: t.goal_id, categoryId: t.category_id
      }, req.user.id)
    } catch (e) { return res.status(400).json({ error: e.message }) }
    await db.prepare("UPDATE transactions SET voided_at=NULL, void_reason='', updated_at=datetime('now') WHERE id=? AND user_id=?").run(t.id, req.user.id)
    if (t.debt_id) await syncDebtBalance(req.user.id, t.debt_id)
    await applyGoalDelta(req.user.id, t.goal_id, t.type, Number(t.amount))
    await recordSnapshot(req.user.id)
    const restored = await own('transactions', req.user.id, t.id)
    await audit(req.user.id, 'restore', 'transaction', t.id, t, restored)
    res.json(restored)
  })

  api.post('/transactions/:id/duplicate', async (req, res) => {
    try {
      const t = await own('transactions', req.user.id, req.params.id)
      if (!t) return res.status(404).json({ error: 'Transaction not found' })
      if (t.voided_at) return res.status(400).json({ error: 'Cannot duplicate a voided transaction' })
      const date = isIsoDate(req.body?.date) ? req.body.date : isoDate()
      const v = await validateTx({
        type: t.type, amount: t.amount, date,
        accountId: t.account_id, toAccountId: t.to_account_id, businessId: t.business_id,
        debtId: t.debt_id, goalId: t.goal_id, categoryId: t.category_id
      }, req.user.id)
      const info = await db.prepare(`INSERT INTO transactions (user_id, amount, date, type, account_id, to_account_id, category_id, business_id, debt_id, goal_id, description, notes, tags, attachment)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, v.amount, date, t.type, v.accountId, v.toAccountId, v.categoryId, v.businessId, v.debtId, v.goalId, t.description, t.notes, t.tags, '')
      if (v.debtId) await syncDebtBalance(req.user.id, v.debtId)
      await applyGoalDelta(req.user.id, v.goalId, t.type, v.amount)
      await recordSnapshot(req.user.id)
      res.json(await own('transactions', req.user.id, info.lastInsertRowid))
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.get('/budgets', async (req, res) => {
    const range = periodRange(req.query.period || 'month', req.query.from, req.query.to)
    res.json(await budgetPerformance(req.user.id, range))
  })

  api.post('/budgets', async (req, res) => {
    try {
      const existing = await replayIdempotent(req, 'budgets')
      if (existing) return res.json(existing)
      const { name, scope, businessId, categoryId, amount, period, startDate, endDate } = req.body
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name and amount are required' })
      const amt = parseMoney(amount, { field: 'Amount' })
      const info = await db.prepare(`INSERT INTO budgets (user_id, name, scope, business_id, category_id, amount, period, start_date, end_date, client_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, String(name).trim(), scope || 'overall', asId(emptyToNull(businessId)), asId(emptyToNull(categoryId)), amt, period || 'monthly', startDate || null, endDate || null, clientKey(req))
      const created = await own('budgets', req.user.id, info.lastInsertRowid)
      await rememberIdempotent(req, 'budgets', created.id)
      res.json(created)
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.put('/budgets/:id', async (req, res) => {
    const b = await own('budgets', req.user.id, req.params.id)
    if (!b) return res.status(404).json({ error: 'Budget not found' })
    const d = req.body
    await db.prepare(`UPDATE budgets SET name=?, scope=?, business_id=?, category_id=?, amount=?, period=?, start_date=?, end_date=?, status=? WHERE id=? AND user_id=?`)
      .run(d.name ?? b.name, d.scope ?? b.scope, d.businessId === undefined ? b.business_id : d.businessId, d.categoryId === undefined ? b.category_id : d.categoryId, d.amount ?? b.amount, d.period ?? b.period, d.startDate ?? b.start_date, d.endDate ?? b.end_date, d.status ?? b.status, b.id, req.user.id)
    res.json(await own('budgets', req.user.id, b.id))
  })

  api.get('/debts', async (req, res) => {
    await syncAllDebts(req.user.id)
    const sort = req.query.sort || 'interest'
    let rows = await db.prepare('SELECT * FROM debts WHERE user_id=?').all(req.user.id)
    const mapped = []
    for (const d of rows) {
      const remaining = await debtBalance(req.user.id, d.id)
      const opening = d.opening_balance != null ? d.opening_balance : d.original_amount
      const paid = fromCents(Math.max(0, toCents(opening) - toCents(remaining)))
      const pct = opening > 0 ? (toCents(paid) / toCents(opening)) * 100 : 0
      mapped.push({ ...d, current_balance: remaining, paid, remaining, percent: round2(pct) })
    }
    rows = mapped
    if (sort === 'balance') rows.sort((a, b) => a.current_balance - b.current_balance)
    else if (sort === 'due') rows.sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
    else if (sort === 'custom') rows.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
    else rows.sort((a, b) => b.interest - a.interest)
    res.json(rows)
  })

  api.post('/debts', async (req, res) => {
    try {
      const existing = await replayIdempotent(req, 'debts')
      if (existing) return res.json(existing)
      const { creditor, originalAmount, currentBalance, interest, dueDate, minimumPayment, priority, notes, status, accountId } = req.body
      if (!creditor || !String(creditor).trim()) return res.status(400).json({ error: 'Creditor and original amount are required' })
      const orig = parseMoney(originalAmount, { field: 'Original amount' })
      const opening = currentBalance != null && currentBalance !== '' ? parseMoney(currentBalance, { allowZero: true, field: 'Current balance' }) : orig
      if (opening > orig) throw new Error('Current balance cannot exceed original amount')
      const acc = emptyToNull(accountId)
      if (acc && !(await own('accounts', req.user.id, acc))) throw new Error('Account not found')
      const info = await db.prepare(`INSERT INTO debts (user_id, creditor, original_amount, current_balance, opening_balance, interest, due_date, minimum_payment, priority, notes, status, account_id, client_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, String(creditor).trim(), orig, opening, opening, Number(interest) || 0, dueDate || null, parseMoney(minimumPayment ?? 0, { allowZero: true, field: 'Minimum payment' }), priority || 'medium', notes || '', status || 'active', asId(acc), clientKey(req))
      await syncDebtBalance(req.user.id, info.lastInsertRowid)
      await recordSnapshot(req.user.id)
      const created = await own('debts', req.user.id, info.lastInsertRowid)
      await rememberIdempotent(req, 'debts', created.id)
      res.json(created)
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.put('/debts/:id', async (req, res) => {
    try {
      const d = await own('debts', req.user.id, req.params.id)
      if (!d) return res.status(404).json({ error: 'Debt not found' })
      const b = req.body
      const orig = b.originalAmount === undefined ? d.original_amount : parseMoney(b.originalAmount, { field: 'Original amount' })
      const acc = b.accountId === undefined ? d.account_id : emptyToNull(b.accountId)
      if (acc && !(await own('accounts', req.user.id, acc))) throw new Error('Account not found')
      await db.prepare(`UPDATE debts SET creditor=?, original_amount=?, interest=?, due_date=?, minimum_payment=?, priority=?, notes=?, status=?, account_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
        .run(b.creditor ?? d.creditor, orig, b.interest ?? d.interest, b.dueDate ?? d.due_date, b.minimumPayment ?? d.minimum_payment, b.priority ?? d.priority, b.notes ?? d.notes, b.status ?? d.status, asId(acc), d.id, req.user.id)
      await syncDebtBalance(req.user.id, d.id)
      await recordSnapshot(req.user.id)
      res.json(await own('debts', req.user.id, d.id))
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.get('/goals', async (req, res) => {
    const goalRows = await db.prepare('SELECT * FROM goals WHERE user_id=?').all(req.user.id)
    const rows = []
    for (const g of goalRows) {
      const current = g.account_id ? await accountBalance(req.user.id, g.account_id) : fromCents(toCents(g.current_amount))
      const remaining = round2(Math.max(0, fromCents(toCents(g.target_amount) - toCents(current))))
      const percent = g.target_amount > 0 ? round2((toCents(current) / toCents(g.target_amount)) * 100) : 0
      rows.push({ ...g, current, remaining, percent })
    }
    res.json(rows)
  })

  api.post('/goals', async (req, res) => {
    try {
      const existing = await replayIdempotent(req, 'goals')
      if (existing) return res.json(existing)
      const { name, targetAmount, currentAmount, targetDate, priority, accountId, notes } = req.body
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name and target amount are required' })
      const target = parseMoney(targetAmount, { field: 'Target amount' })
      const current = parseMoney(currentAmount ?? 0, { allowZero: true, field: 'Current amount' })
      const acc = emptyToNull(accountId)
      if (acc && !(await own('accounts', req.user.id, acc))) throw new Error('Account not found')
      const info = await db.prepare(`INSERT INTO goals (user_id, name, target_amount, current_amount, target_date, priority, account_id, notes, client_id)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, String(name).trim(), target, current, targetDate || null, priority || 'medium', asId(acc), notes || '', clientKey(req))
      const created = await own('goals', req.user.id, info.lastInsertRowid)
      await rememberIdempotent(req, 'goals', created.id)
      res.json(created)
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.put('/goals/:id', async (req, res) => {
    const g = await own('goals', req.user.id, req.params.id)
    if (!g) return res.status(404).json({ error: 'Goal not found' })
    const b = req.body
    await db.prepare(`UPDATE goals SET name=?, target_amount=?, current_amount=?, target_date=?, priority=?, account_id=?, notes=?, status=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
      .run(b.name ?? g.name, b.targetAmount ?? g.target_amount, b.currentAmount ?? g.current_amount, b.targetDate ?? g.target_date, b.priority ?? g.priority, b.accountId === undefined ? g.account_id : b.accountId, b.notes ?? g.notes, b.status ?? g.status, g.id, req.user.id)
    res.json(await own('goals', req.user.id, g.id))
  })

  api.get('/recurring', async (req, res) => {
    let sql = 'SELECT * FROM recurring_transactions WHERE user_id=?'
    const params = [req.user.id]
    if (req.query.businessId === 'personal') sql += ' AND business_id IS NULL'
    else if (req.query.businessId) { sql += ' AND business_id=?'; params.push(asId(req.query.businessId)) }
    if (req.query.type) { sql += ' AND type=?'; params.push(req.query.type) }
    sql += ' ORDER BY next_date'
    res.json(await db.prepare(sql).all(...params))
  })

  api.post('/recurring', async (req, res) => {
    try {
      const existing = await replayIdempotent(req, 'recurring_transactions')
      if (existing) return res.json(existing)
      const { amount, frequency, startDate, endDate, accountId, toAccountId, categoryId, businessId, debtId, type, description } = req.body
      if (!frequency || !isIsoDate(startDate) || !type || !TX_TYPES.includes(type)) return res.status(400).json({ error: 'Amount, frequency, start date and type are required' })
      const amt = parseMoney(amount, { field: 'Amount' })
      if (accountId && !(await own('accounts', req.user.id, accountId))) throw new Error('Account not found')
      if (toAccountId && !(await own('accounts', req.user.id, toAccountId))) throw new Error('Account not found')
      const biz = emptyToNull(businessId)
      if (biz && !(await own('businesses', req.user.id, biz))) throw new Error('Business not found')
      if (categoryId && !(await own('categories', req.user.id, categoryId))) throw new Error('Category not found')
      if (debtId && !(await own('debts', req.user.id, debtId))) throw new Error('Debt not found')
      const info = await db.prepare(`INSERT INTO recurring_transactions (user_id, amount, frequency, start_date, end_date, next_date, account_id, to_account_id, category_id, business_id, debt_id, type, description)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, amt, frequency, startDate, endDate || null, startDate, asId(emptyToNull(accountId)), asId(emptyToNull(toAccountId)), asId(emptyToNull(categoryId)), asId(biz), asId(emptyToNull(debtId)), type, description || '')
      const created = await own('recurring_transactions', req.user.id, info.lastInsertRowid)
      await rememberIdempotent(req, 'recurring_transactions', created.id)
      res.json(created)
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.put('/recurring/:id', async (req, res) => {
    const r = await own('recurring_transactions', req.user.id, req.params.id)
    if (!r) return res.status(404).json({ error: 'Not found' })
    const b = req.body
    await db.prepare(`UPDATE recurring_transactions SET amount=?, frequency=?, start_date=?, end_date=?, next_date=?, account_id=?, to_account_id=?, category_id=?, business_id=?, debt_id=?, type=?, description=?, status=? WHERE id=? AND user_id=?`)
      .run(b.amount ?? r.amount, b.frequency ?? r.frequency, b.startDate ?? r.start_date, b.endDate ?? r.end_date, b.nextDate ?? r.next_date, b.accountId ?? r.account_id, b.toAccountId ?? r.to_account_id, b.categoryId ?? r.category_id, b.businessId ?? r.business_id, b.debtId ?? r.debt_id, b.type ?? r.type, b.description ?? r.description, b.status ?? r.status, r.id, req.user.id)
    res.json(await own('recurring_transactions', req.user.id, r.id))
  })

  api.post('/recurring/:id/confirm', async (req, res) => {
    try {
      const r = await own('recurring_transactions', req.user.id, req.params.id)
      if (!r) return res.status(404).json({ error: 'Not found' })
      const date = isIsoDate(req.body?.date) ? req.body.date : r.next_date
      const v = await validateTx({
        type: r.type, amount: r.amount, date,
        accountId: r.account_id, toAccountId: r.to_account_id, businessId: r.business_id,
        debtId: r.debt_id, categoryId: r.category_id
      }, req.user.id)
      const info = await db.prepare(`INSERT INTO transactions (user_id, amount, date, type, account_id, to_account_id, category_id, business_id, debt_id, description, recurring_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.id, v.amount, date, r.type, v.accountId, v.toAccountId, v.categoryId, v.businessId, v.debtId, r.description, r.id)
      const next = nextRecurringDate(date, r.frequency)
      await db.prepare('UPDATE recurring_transactions SET next_date=? WHERE id=? AND user_id=?').run(next, r.id, req.user.id)
      if (v.debtId) await syncDebtBalance(req.user.id, v.debtId)
      await recordSnapshot(req.user.id)
      res.json(await own('transactions', req.user.id, info.lastInsertRowid))
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.get('/allocations', async (req, res) => {
    const rules = await db.prepare('SELECT * FROM allocation_rules WHERE user_id=?').all(req.user.id)
    res.json(rules.map(r => ({ ...r, splits: JSON.parse(r.splits || '[]') })))
  })

  api.post('/allocations', async (req, res) => {
    const { name, triggerType, source, splits, enabled } = req.body
    if (!name || !Array.isArray(splits)) return res.status(400).json({ error: 'Name and splits are required' })
    const info = await db.prepare(`INSERT INTO allocation_rules (user_id, name, trigger_type, source, splits, enabled) VALUES (?,?,?,?,?,?)`)
      .run(req.user.id, name, triggerType || 'income', source || '', JSON.stringify(splits), enabled === false ? 0 : 1)
    const r = await own('allocation_rules', req.user.id, info.lastInsertRowid)
    res.json({ ...r, splits: JSON.parse(r.splits) })
  })

  api.put('/allocations/:id', async (req, res) => {
    const r = await own('allocation_rules', req.user.id, req.params.id)
    if (!r) return res.status(404).json({ error: 'Not found' })
    const b = req.body
    await db.prepare(`UPDATE allocation_rules SET name=?, trigger_type=?, source=?, splits=?, enabled=? WHERE id=? AND user_id=?`)
      .run(b.name ?? r.name, b.triggerType ?? r.trigger_type, b.source ?? r.source, JSON.stringify(b.splits ?? JSON.parse(r.splits)), b.enabled === false ? 0 : (b.enabled === true ? 1 : r.enabled), r.id, req.user.id)
    const u = await own('allocation_rules', req.user.id, r.id)
    res.json({ ...u, splits: JSON.parse(u.splits) })
  })

  api.post('/allocations/:id/preview', async (req, res) => {
    try { res.json(await applyAllocation(req.user.id, req.body.amount, Number(req.params.id))) }
    catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.get('/dashboard', async (req, res) => {
    await syncAllDebts(req.user.id)
    await refreshNotifications(req.user.id)
    const range = periodRange(req.query.period || 'month', req.query.from, req.query.to)
    const scope = req.query.scope || 'all'
    const businessId = req.query.businessId
    const opts = { ...range, scope: scope === 'personal' || scope === 'business' ? scope : undefined, businessId }
    const nw = await netWorth(req.user.id)
    const stats = await periodStats(req.user.id, opts)
    const accounts = await allAccountBalances(req.user.id)
    const bizRows = await db.prepare("SELECT * FROM businesses WHERE user_id=? AND status!='archived'").all(req.user.id)
    const businesses = []
    for (const b of bizRows) {
      const s = await periodStats(req.user.id, { ...range, businessId: b.id })
      businesses.push({ ...b, revenue: s.businessRevenue, expenses: s.businessExpenses, profit: s.businessProfit })
    }
    const debts = await db.prepare("SELECT * FROM debts WHERE user_id=? AND status IN ('active','overdue')").all(req.user.id)
    const goalRows = await db.prepare("SELECT * FROM goals WHERE user_id=? AND status='active'").all(req.user.id)
    const goals = []
    for (const g of goalRows) {
      const current = g.account_id ? await accountBalance(req.user.id, g.account_id) : Number(g.current_amount)
      goals.push({ ...g, current, remaining: round2(Math.max(0, g.target_amount - current)), percent: g.target_amount > 0 ? round2((current / g.target_amount) * 100) : 0 })
    }
    const recent = (await txFilter(req.user.id, opts)).slice(0, 8)
    await recordSnapshot(req.user.id)
    res.json({
      netWorth: nw,
      stats,
      health: await financialHealthScore(req.user.id),
      nextAction: await nextAction(req.user.id),
      cashFlow: await cashFlowSeries(req.user.id, opts),
      expenses: await expenseDistribution(req.user.id, opts),
      accounts, businesses, debts, goals, recent,
      range
    })
  })

  api.get('/reports', async (req, res) => {
    const range = periodRange(req.query.period || 'month', req.query.from, req.query.to)
    const scope = req.query.scope
    const businessId = req.query.businessId
    const opts = { ...range, scope, businessId }
    const snaps = await db.prepare('SELECT * FROM financial_snapshots WHERE user_id=? AND date>=? AND date<=? ORDER BY date').all(req.user.id, range.from, range.to)
    const reportBiz = await db.prepare('SELECT * FROM businesses WHERE user_id=?').all(req.user.id)
    const businesses = []
    for (const b of reportBiz) businesses.push({ ...b, ...await periodStats(req.user.id, { ...range, businessId: b.id }) })
    res.json({
      range,
      stats: await periodStats(req.user.id, opts),
      cashFlow: await cashFlowSeries(req.user.id, opts),
      expenses: await expenseDistribution(req.user.id, opts),
      netWorthHistory: snaps,
      budgets: await budgetPerformance(req.user.id, range),
      debts: await db.prepare('SELECT * FROM debts WHERE user_id=?').all(req.user.id),
      businesses
    })
  })

  api.get('/coach', async (req, res) => res.json({ insights: await coachInsights(req.user.id), nextAction: await nextAction(req.user.id), health: await financialHealthScore(req.user.id) }))

  api.post('/afford', async (req, res) => res.json(await affordability(req.user.id, req.body.amount)))

  api.get('/calendar', async (req, res) => {
    const today = isoDate()
    const [y, m] = today.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const from = isIsoDate(req.query.from) ? req.query.from : `${y}-${String(m).padStart(2, '0')}-01`
    const to = isIsoDate(req.query.to) ? req.query.to : `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    const events = []
    const debts = await db.prepare("SELECT * FROM debts WHERE user_id=? AND due_date IS NOT NULL AND due_date>=? AND due_date<=?").all(req.user.id, from, to)
    for (const d of debts) events.push({ date: d.due_date, kind: 'debt', status: d.status === 'overdue' ? 'overdue' : 'expected', title: `${d.creditor} due`, amount: d.minimum_payment || d.current_balance, id: d.id })
    const confirmed = await db.prepare(`SELECT * FROM transactions WHERE user_id=? AND date>=? AND date<=? AND ${LIVE_TX}`).all(req.user.id, from, to)
    const confirmedRec = new Set(confirmed.filter(t => t.recurring_id).map(t => `${t.recurring_id}:${t.date}`))
    const rec = await db.prepare("SELECT * FROM recurring_transactions WHERE user_id=? AND status='active'").all(req.user.id)
    for (const r of rec) {
      let d = r.start_date
      let guard = 0
      while (d && d <= to && guard++ < 400) {
        if (d >= from && (!r.end_date || d <= r.end_date) && !confirmedRec.has(`${r.id}:${d}`)) {
          events.push({ date: d, kind: 'recurring', status: 'expected', title: r.description || r.type, amount: r.amount, id: r.id, type: r.type, businessId: r.business_id })
        }
        d = nextRecurringDate(d, r.frequency)
        if (r.end_date && d > r.end_date) break
      }
    }
    for (const t of confirmed) events.push({ date: t.date, kind: 'transaction', status: 'confirmed', title: t.description || t.type, amount: t.amount, id: t.id, type: t.type })
    const goals = await db.prepare("SELECT * FROM goals WHERE user_id=? AND target_date IS NOT NULL AND target_date>=? AND target_date<=?").all(req.user.id, from, to)
    for (const g of goals) events.push({ date: g.target_date, kind: 'goal', status: 'expected', title: g.name, amount: g.target_amount, id: g.id })
    events.sort((a, b) => a.date.localeCompare(b.date))
    res.json({ from, to, events })
  })

  api.get('/search', async (req, res) => {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ transactions: [], accounts: [], businesses: [], debts: [], goals: [], categories: [] })
    const like = `%${q}%`
    const uid = req.user.id
    res.json({
      transactions: await db.prepare(`SELECT * FROM transactions WHERE user_id=? AND ${LIVE_TX} AND (description LIKE ? OR notes LIKE ? OR tags LIKE ?) ORDER BY date DESC LIMIT 20`).all(uid, like, like, like),
      accounts: await db.prepare('SELECT * FROM accounts WHERE user_id=? AND (name LIKE ? OR provider LIKE ?) LIMIT 10').all(uid, like, like),
      businesses: await db.prepare('SELECT * FROM businesses WHERE user_id=? AND (name LIKE ? OR description LIKE ?) LIMIT 10').all(uid, like, like),
      debts: await db.prepare('SELECT * FROM debts WHERE user_id=? AND (creditor LIKE ? OR notes LIKE ?) LIMIT 10').all(uid, like, like),
      goals: await db.prepare('SELECT * FROM goals WHERE user_id=? AND (name LIKE ? OR notes LIKE ?) LIMIT 10').all(uid, like, like),
      categories: await db.prepare('SELECT * FROM categories WHERE user_id=? AND name LIKE ? LIMIT 10').all(uid, like)
    })
  })

  api.get('/notifications', async (req, res) => {
    await refreshNotifications(req.user.id)
    res.json(await db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id))
  })

  api.post('/notifications/:id/read', async (req, res) => {
    const n = await own('notifications', req.user.id, req.params.id)
    if (!n) return res.status(404).json({ error: 'Not found' })
    await db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(n.id, req.user.id)
    res.json({ ok: true })
  })

  api.get('/data/export', async (req, res) => {
    const payload = await exportUser(req.user.id)
    await audit(req.user.id, 'export', 'user', req.user.id)
    res.setHeader('Content-Disposition', `attachment; filename="finance-os-${isoDate()}.json"`)
    res.json(payload)
  })

  api.post('/data/restore', async (req, res) => {
    try {
      await restoreUser(req.user.id, req.body)
      await recordSnapshot(req.user.id)
      res.json({ ok: true })
    } catch (e) { res.status(400).json({ error: e.message }) }
  })

  api.get('/data/backups', async (_req, res) => {
    res.json({
      backups: listBackups(),
      integrity: (await integrityOk()) ? 'ok' : 'failed'
    })
  })

  api.post('/data/backup', async (_req, res) => {
    const dest = await backupNow('manual')
    res.json({ ok: true, file: dest ? path.basename(dest) : null, store: db.dialect })
  })

  api.get('/audit', async (req, res) => {
    const rows = await db.prepare('SELECT id, action, entity, entity_id, created_at FROM audit_log WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)
    res.json(rows)
  })

  api.get('/files/:kind/:filename', async (req, res) => {
    const kind = req.params.kind
    if (kind !== 'logos' && kind !== 'attachments') return res.status(404).json({ error: 'Not found' })
    const filename = path.basename(req.params.filename)
    if (!filename || filename.includes('..')) return res.status(400).json({ error: 'Invalid file' })
    const apiPath = `/api/files/${kind}/${filename}`
    const legacy = `/uploads/${kind}/${filename}`
    let owned = false
    if (kind === 'logos') {
      owned = !!(await db.prepare('SELECT id FROM businesses WHERE user_id=? AND logo IN (?,?)').get(req.user.id, apiPath, legacy))
    } else {
      owned = !!(await db.prepare('SELECT id FROM transactions WHERE user_id=? AND attachment IN (?,?)').get(req.user.id, apiPath, legacy))
        || !!(await db.prepare('SELECT id FROM attachments WHERE user_id=? AND (filename=? OR path IN (?,?))').get(req.user.id, filename, apiPath, legacy))
    }
    if (!owned) return res.status(404).json({ error: 'Not found' })
    const full = path.join(uploadsDir, kind, filename)
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' })
    res.sendFile(full)
  })

  app.get('/api/health', async (_req, res) => res.json({
    ok: true,
    name: 'Finance OS',
    store: db.dialect,
    integrity: (await integrityOk()) ? 'ok' : 'failed',
    backups: listBackups().length,
    auth: jwtConfigured() ? 'ok' : 'unconfigured'
  }))

  app.use('/api', api)
  app.use('/api', async (_req, res) => res.status(404).json({ error: 'Not found' }))

  app.use((err, _req, res, _next) => {
    res.status(400).json({ error: err.message || 'Request failed' })
  })

  if (process.env.VERCEL) {
    /* static assets and SPA fallback are served by the platform */
  } else if (isProd) {
    const dist = path.join(__dirname, '..', 'dist')
    app.use(express.static(dist))
    app.get('*', async (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      configFile: path.join(__dirname, '..', 'client', 'vite.config.js'),
      appType: 'spa',
      server: { middlewareMode: true, allowedHosts: ['.monkeycode-ai.live', 'localhost', '.localhost'] }
    })
    app.use(vite.middlewares)
  }

  return app
}

async function start() {
  const app = await createApp()
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Finance OS listening on http://0.0.0.0:${PORT}`)
  })

  async function shutdown() {
    try { await backupNow('shutdown') } catch { /* keep going */ }
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000)
  }
  process.on('SIGTERM', () => { shutdown().catch(() => process.exit(0)) })
  process.on('SIGINT', () => { shutdown().catch(() => process.exit(0)) })
}

async function applyGoalDelta(userId, goalId, type, amount) {
  if (!goalId || !amount) return
  if (!['income', 'transfer', 'adjustment'].includes(type)) return
  const g = await own('goals', userId, goalId)
  if (!g || g.account_id) return
  await db.prepare("UPDATE goals SET current_amount = MAX(0, current_amount + ?), updated_at=datetime('now') WHERE id=? AND user_id=?")
    .run(amount, g.id, userId)
}

function nextRecurringDate(date, frequency) {
  const [y0, m0, d0] = String(date).split('-').map(Number)
  const d = new Date(Date.UTC(y0, m0 - 1, d0))
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
  else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14)
  else if (frequency === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d.toISOString().slice(0, 10)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  start().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
