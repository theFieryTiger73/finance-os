import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createPgDatabase, databaseUrlFromEnv } from './pg.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const onVercel = Boolean(process.env.VERCEL)
const dataDir = process.env.DATA_DIR || (onVercel ? '/tmp/finance-os' : path.join(__dirname, '..', 'data'))
const uploadsDir = process.env.UPLOADS_DIR || ((onVercel || process.env.DATA_DIR) ? path.join(dataDir, 'uploads') : path.join(__dirname, '..', 'uploads'))
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(path.join(uploadsDir, 'logos'), { recursive: true })
fs.mkdirSync(path.join(uploadsDir, 'attachments'), { recursive: true })

const dbPath = path.join(dataDir, 'finance.db')
const backupsDir = path.join(dataDir, 'backups')
fs.mkdirSync(backupsDir, { recursive: true })

export const LIVE_TX = "COALESCE(voided_at,'') = ''"

function databaseUrl() {
  return databaseUrlFromEnv()
}

function wrapSqlite(raw) {
  return {
    dialect: 'sqlite',
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (...p) => stmt.get(...p),
        all: async (...p) => stmt.all(...p),
        run: async (...p) => stmt.run(...p)
      }
    },
    async exec(sql) { raw.exec(sql) }
  }
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  country TEXT DEFAULT 'MZ',
  currency TEXT DEFAULT 'MZN',
  language TEXT DEFAULT 'en',
  theme TEXT DEFAULT 'light',
  onboarding_completed INTEGER DEFAULT 0,
  onboarding_step INTEGER DEFAULT 0,
  emergency_fund_target REAL DEFAULT 0,
  min_liquidity REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  provider TEXT DEFAULT '',
  currency TEXT DEFAULT 'MZN',
  initial_balance REAL NOT NULL DEFAULT 0,
  icon TEXT DEFAULT 'wallet',
  color TEXT DEFAULT '#2E90FA',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  business_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  logo TEXT DEFAULT '',
  description TEXT DEFAULT '',
  type TEXT DEFAULT 'other',
  brand_color TEXT DEFAULT '#7A5AF8',
  currency TEXT DEFAULT 'MZN',
  status TEXT DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'tag',
  color TEXT DEFAULT '#2E90FA',
  type TEXT NOT NULL,
  scope TEXT DEFAULT 'personal',
  business_id INTEGER,
  parent_id INTEGER,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  account_id INTEGER,
  to_account_id INTEGER,
  category_id INTEGER,
  business_id INTEGER,
  debt_id INTEGER,
  goal_id INTEGER,
  description TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  attachment TEXT DEFAULT '',
  recurring_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope TEXT DEFAULT 'overall',
  business_id INTEGER,
  category_id INTEGER,
  amount REAL NOT NULL,
  period TEXT DEFAULT 'monthly',
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  creditor TEXT NOT NULL,
  original_amount REAL NOT NULL,
  current_balance REAL NOT NULL,
  interest REAL DEFAULT 0,
  due_date TEXT,
  minimum_payment REAL DEFAULT 0,
  priority TEXT DEFAULT 'medium',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  account_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  current_amount REAL DEFAULT 0,
  target_date TEXT,
  priority TEXT DEFAULT 'medium',
  account_id INTEGER,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_date TEXT NOT NULL,
  account_id INTEGER,
  to_account_id INTEGER,
  category_id INTEGER,
  business_id INTEGER,
  debt_id INTEGER,
  type TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  transaction_id INTEGER,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS financial_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  net_worth REAL NOT NULL,
  assets REAL NOT NULL,
  liabilities REAL NOT NULL,
  cash REAL NOT NULL,
  debt REAL NOT NULL,
  UNIQUE(user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS allocation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT DEFAULT 'income',
  source TEXT DEFAULT '',
  splits TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_businesses_user ON businesses(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_tx_to_account ON transactions(user_id, to_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_business ON transactions(user_id, business_id);
CREATE INDEX IF NOT EXISTS idx_tx_debt ON transactions(user_id, debt_id);
CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_date ON financial_snapshots(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT DEFAULT '',
  after_json TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
`

function addColumn(raw, sql) {
  try { raw.exec(sql) } catch { /* already exists */ }
}

async function createSqliteDatabase() {
  const raw = new DatabaseSync(dbPath)
  raw.exec(onVercel ? 'PRAGMA journal_mode = DELETE' : 'PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA synchronous = FULL')
  raw.exec('PRAGMA busy_timeout = 8000')
  raw.exec('PRAGMA foreign_keys = ON')
  raw.exec('PRAGMA wal_autocheckpoint = 500')
  raw.exec('PRAGMA temp_store = MEMORY')
  raw.exec(SQLITE_SCHEMA)
  addColumn(raw, 'ALTER TABLE debts ADD COLUMN opening_balance REAL')
  addColumn(raw, 'ALTER TABLE transactions ADD COLUMN voided_at TEXT')
  addColumn(raw, "ALTER TABLE transactions ADD COLUMN void_reason TEXT DEFAULT ''")
  addColumn(raw, 'ALTER TABLE transactions ADD COLUMN client_id TEXT')
  addColumn(raw, 'ALTER TABLE accounts ADD COLUMN client_id TEXT')
  addColumn(raw, 'ALTER TABLE businesses ADD COLUMN client_id TEXT')
  addColumn(raw, 'ALTER TABLE debts ADD COLUMN client_id TEXT')
  addColumn(raw, 'ALTER TABLE goals ADD COLUMN client_id TEXT')
  addColumn(raw, 'ALTER TABLE budgets ADD COLUMN client_id TEXT')
  raw.exec(`
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_client ON transactions(user_id, client_id) WHERE client_id IS NOT NULL AND client_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_acc_client ON accounts(user_id, client_id) WHERE client_id IS NOT NULL AND client_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_client ON businesses(user_id, client_id) WHERE client_id IS NOT NULL AND client_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_client ON debts(user_id, client_id) WHERE client_id IS NOT NULL AND client_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_client ON goals(user_id, client_id) WHERE client_id IS NOT NULL AND client_id != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_client ON budgets(user_id, client_id) WHERE client_id IS NOT NULL AND client_id != '';
`)
  return wrapSqlite(raw)
}

async function migrateOpeningBalances(database) {
  const debtsNeedOpening = await database.prepare('SELECT id, original_amount, current_balance FROM debts WHERE opening_balance IS NULL').all()
  const setOpening = database.prepare('UPDATE debts SET opening_balance = ? WHERE id = ?')
  for (const d of debtsNeedOpening) {
    const paidRow = await database.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE debt_id = ? AND type = 'debt_payment' AND ${LIVE_TX}`).get(d.id)
    await setOpening.run(Number(d.current_balance) + Number(paidRow?.s || 0), d.id)
  }
}

const url = databaseUrl()
export const db = url ? await createPgDatabase(url) : await createSqliteDatabase()
await migrateOpeningBalances(db)

export async function seedDefaultCategories(userId) {
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM categories WHERE user_id = ?').get(userId)).c
  if (count > 0) return
  const insert = db.prepare(`
    INSERT INTO categories (user_id, name, icon, color, type, scope)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const rows = [
    ['Salary', 'briefcase', '#12B76A', 'income', 'personal'],
    ['Freelance', 'laptop', '#12B76A', 'income', 'personal'],
    ['Other Income', 'plus-circle', '#12B76A', 'income', 'personal'],
    ['Business Revenue', 'store', '#12B76A', 'income', 'business'],
    ['Food', 'utensils', '#F04438', 'expense', 'personal'],
    ['Transport', 'car', '#F79009', 'expense', 'personal'],
    ['Housing', 'home', '#2E90FA', 'expense', 'personal'],
    ['Utilities', 'zap', '#F79009', 'expense', 'personal'],
    ['Health', 'heart', '#F04438', 'expense', 'personal'],
    ['Education', 'book', '#7A5AF8', 'expense', 'personal'],
    ['Entertainment', 'film', '#7A5AF8', 'expense', 'personal'],
    ['Shopping', 'shopping-bag', '#F04438', 'expense', 'personal'],
    ['Subscriptions', 'repeat', '#2E90FA', 'expense', 'personal'],
    ['Other Expense', 'more-horizontal', '#667085', 'expense', 'personal'],
    ['Operating Costs', 'settings', '#F04438', 'expense', 'business'],
    ['Marketing', 'megaphone', '#F79009', 'expense', 'business'],
    ['Supplies', 'package', '#2E90FA', 'expense', 'business'],
    ['Payroll', 'users', '#7A5AF8', 'expense', 'business']
  ]
  await db.exec('BEGIN')
  try {
    for (const r of rows) await insert.run(userId, ...r)
    await db.exec('COMMIT')
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
}

export { dataDir, uploadsDir, backupsDir, dbPath }
