import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { db, seedDefaultCategories, dataDir } from './db.js'

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  const secretFile = path.join(dataDir, '.jwt-secret')
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim()
  const secret = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(secretFile, secret, { mode: 0o600 })
  return secret
}

const JWT_SECRET = loadJwtSecret()

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '14d' })
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '')
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (!user) return res.status(401).json({ error: 'Invalid session' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }
}

export function publicUser(u) {
  if (!u) return null
  return {
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    country: u.country,
    currency: u.currency,
    language: u.language,
    theme: u.theme,
    onboardingCompleted: !!u.onboarding_completed,
    onboardingStep: u.onboarding_step,
    emergencyFundTarget: u.emergency_fund_target,
    minLiquidity: u.min_liquidity,
    brandName: `${u.first_name}'s Finance OS`
  }
}

export function register({ firstName, lastName, email, password, country, currency }) {
  if (!firstName || !lastName || !email || !password) throw new Error('First name, last name, email and password are required')
  if (password.length < 8) throw new Error('Password must be at least 8 characters')
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)
  if (existing) throw new Error('An account with this email already exists')
  const hash = bcrypt.hashSync(password, 10)
  const info = db.prepare(`
    INSERT INTO users (first_name, last_name, email, password_hash, country, currency)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(firstName.trim(), lastName.trim(), email.trim().toLowerCase(), hash, country || 'MZ', currency || 'MZN')
  seedDefaultCategories(info.lastInsertRowid)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
}

export function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email || '')
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) throw new Error('Invalid email or password')
  return user
}

export function createResetToken(email) {
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email || '')
  if (!user) return null
  const token = crypto.randomBytes(24).toString('hex')
  const expires = new Date(Date.now() + 1000 * 60 * 60).toISOString()
  db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expires)
  return { token, email: user.email }
}

export function resetPassword(token, password) {
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters')
  const row = db.prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')").get(token)
  if (!row) throw new Error('Invalid or expired reset token')
  const hash = bcrypt.hashSync(password, 10)
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, row.user_id)
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)
}
