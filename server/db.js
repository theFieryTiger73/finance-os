import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
const uploadsDir = path.join(__dirname, '..', 'uploads')
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(path.join(uploadsDir, 'logos'), { recursive: true })
fs.mkdirSync(path.join(uploadsDir, 'attachments'), { recursive: true })

const db = new DatabaseSync(path.join(dataDir, 'finance.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
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
`)

export function seedDefaultCategories(userId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM categories WHERE user_id = ?').get(userId).c
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
  db.exec('BEGIN')
  try {
    for (const r of rows) insert.run(userId, ...r)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export { db, dataDir, uploadsDir }
