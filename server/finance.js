import { db, LIVE_TX } from './db.js'
import { toCents, fromCents, sameId, isoDate as maputoDate } from './money.js'

export const ACCOUNT_TYPES = [
  'cash', 'bank', 'mobile_money', 'savings', 'credit_card', 'digital_wallet', 'investment', 'other'
]
export const TX_TYPES = [
  'income', 'expense', 'transfer', 'debt_payment', 'owner_draw', 'owner_contribution', 'investment', 'refund', 'adjustment'
]
export const ASSET_TYPES = new Set(['cash', 'bank', 'mobile_money', 'savings', 'digital_wallet', 'investment', 'other'])
export const LIABILITY_ACCOUNT_TYPES = new Set(['credit_card'])
export const CASH_TYPES = new Set(['cash', 'bank', 'mobile_money', 'savings', 'digital_wallet'])

export function isoDate(d = new Date()) {
  return maputoDate(d)
}

function maputoYmd(d = new Date()) {
  const s = maputoDate(d)
  const [y, m, day] = s.split('-').map(Number)
  return { y, m, day, s }
}

function monthEnd(y, m) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function periodRange(period, customFrom, customTo) {
  const { y, m, s } = maputoYmd()
  if (period === 'year') return { from: `${y}-01-01`, to: s }
  if (period === 'quarter') {
    const q = Math.floor((m - 1) / 3) * 3 + 1
    return { from: `${y}-${String(q).padStart(2, '0')}-01`, to: s }
  }
  if (period === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo }
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: s }
}

export async function accountBalance(userId, accountId) {
  const acc = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId)
  if (!acc) return 0
  const txs = await db.prepare(`SELECT * FROM transactions WHERE user_id = ? AND (account_id = ? OR to_account_id = ?) AND ${LIVE_TX}`).all(userId, accountId, accountId)
  let cents = toCents(acc.initial_balance)
  for (const t of txs) cents += effectOnAccountCents(t, accountId)
  return fromCents(cents)
}

function effectOnAccountCents(t, accountId) {
  const amt = toCents(t.amount)
  const from = sameId(t.account_id, accountId)
  const to = sameId(t.to_account_id, accountId)
  switch (t.type) {
    case 'income':
    case 'owner_contribution':
    case 'refund':
      return from ? amt : 0
    case 'expense':
    case 'owner_draw':
    case 'debt_payment':
      return from ? -amt : 0
    case 'transfer':
    case 'investment':
      if (from) return -amt
      if (to) return amt
      return 0
    case 'adjustment':
      return from ? amt : 0
    default:
      return 0
  }
}

export async function allAccountBalances(userId, { includeArchived = false } = {}) {
  const sql = includeArchived
    ? 'SELECT * FROM accounts WHERE user_id = ?'
    : "SELECT * FROM accounts WHERE user_id = ? AND status != 'archived'"
  const accounts = await db.prepare(sql).all(userId)
  const out = []
  for (const a of accounts) out.push({ ...a, balance: await accountBalance(userId, a.id) })
  return out
}

export async function debtBalance(userId, debtId) {
  const d = await db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(debtId, userId)
  if (!d) return 0
  const opening = d.opening_balance != null ? d.opening_balance : d.original_amount
  const paid = (await db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE user_id = ? AND debt_id = ? AND type = 'debt_payment' AND ${LIVE_TX}`).get(userId, debtId)).s
  return fromCents(Math.max(0, toCents(opening) - toCents(paid)))
}

export async function syncDebtBalance(userId, debtId) {
  const d = await db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(debtId, userId)
  if (!d) return 0
  const remaining = await debtBalance(userId, debtId)
  let status = d.status
  if (d.status !== 'archived') {
    if (remaining <= 0) status = 'paid'
    else if (d.due_date && d.due_date < isoDate() && remaining > 0) status = 'overdue'
    else if (status === 'paid' || status === 'overdue') status = 'active'
  }
  await db.prepare("UPDATE debts SET current_balance = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(remaining, status, debtId, userId)
  return remaining
}

export async function goalProgress(userId, goalId) {
  const g = await db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId)
  if (!g) return 0
  if (g.account_id) return accountBalance(userId, g.account_id)
  return fromCents(toCents(g.current_amount))
}

export async function syncAllDebts(userId) {
  const rows = await db.prepare("SELECT id FROM debts WHERE user_id = ? AND status != 'archived'").all(userId)
  for (const d of rows) await syncDebtBalance(userId, d.id)
}

export async function netWorth(userId) {
  const accounts = await allAccountBalances(userId, { includeArchived: true })
  let assetCents = 0
  let liabilityCents = 0
  let cashCents = 0
  for (const a of accounts) {
    const c = toCents(a.balance)
    if (LIABILITY_ACCOUNT_TYPES.has(a.type)) {
      liabilityCents += Math.abs(c)
    } else {
      assetCents += c
      if (CASH_TYPES.has(a.type) && a.status !== 'archived') cashCents += c
    }
  }
  const debts = await db.prepare("SELECT * FROM debts WHERE user_id = ? AND status IN ('active','overdue')").all(userId)
  let debtCents = 0
  for (const d of debts) {
    const bal = toCents(await debtBalance(userId, d.id))
    debtCents += bal
    liabilityCents += bal
  }
  return {
    assets: fromCents(assetCents),
    liabilities: fromCents(liabilityCents),
    netWorth: fromCents(assetCents - liabilityCents),
    cash: fromCents(cashCents),
    debt: fromCents(debtCents)
  }
}

export async function recordSnapshot(userId) {
  const nw = await netWorth(userId)
  const date = isoDate()
  await db.prepare(`
    INSERT INTO financial_snapshots (user_id, date, net_worth, assets, liabilities, cash, debt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      net_worth = excluded.net_worth,
      assets = excluded.assets,
      liabilities = excluded.liabilities,
      cash = excluded.cash,
      debt = excluded.debt
  `).run(userId, date, nw.netWorth, nw.assets, nw.liabilities, nw.cash, nw.debt)
  return nw
}

async function txFilter(userId, { from, to, scope, businessId }) {
  let sql = `SELECT * FROM transactions WHERE user_id = ? AND ${LIVE_TX}`
  const params = [userId]
  if (from) { sql += ' AND date >= ?'; params.push(from) }
  if (to) { sql += ' AND date <= ?'; params.push(to) }
  if (scope === 'personal') sql += ' AND business_id IS NULL'
  else if (scope === 'business' && !businessId) sql += ' AND business_id IS NOT NULL'
  if (businessId) { sql += ' AND business_id = ?'; params.push(Number(businessId)) }
  sql += ' ORDER BY date DESC, id DESC'
  return await db.prepare(sql).all(...params)
}

export async function periodStats(userId, opts = {}) {
  const txs = await txFilter(userId, opts)
  let income = 0, expenses = 0, businessRevenue = 0, businessExpenses = 0, ownerDraws = 0, ownerContrib = 0, debtPayments = 0
  for (const t of txs) {
    const amt = toCents(t.amount)
    if (t.type === 'income') {
      income += amt
      if (t.business_id) businessRevenue += amt
    } else if (t.type === 'expense') {
      expenses += amt
      if (t.business_id) businessExpenses += amt
    } else if (t.type === 'refund') {
      expenses -= amt
      if (t.business_id) businessExpenses -= amt
    } else if (t.type === 'owner_draw') {
      ownerDraws += amt
    } else if (t.type === 'owner_contribution') {
      ownerContrib += amt
    } else if (t.type === 'debt_payment') {
      debtPayments += amt
    }
  }
  return {
    income: fromCents(income),
    expenses: fromCents(Math.max(0, expenses)),
    netCashFlow: fromCents(income - expenses),
    businessRevenue: fromCents(businessRevenue),
    businessExpenses: fromCents(Math.max(0, businessExpenses)),
    businessProfit: fromCents(businessRevenue - businessExpenses),
    ownerDraws: fromCents(ownerDraws),
    ownerContributions: fromCents(ownerContrib),
    debtPayments: fromCents(debtPayments)
  }
}

export async function cashFlowSeries(userId, opts = {}) {
  const txs = (await txFilter(userId, opts)).slice().reverse()
  const map = {}
  for (const t of txs) {
    const d = t.date.slice(0, 10)
    if (!map[d]) map[d] = { date: d, income: 0, expenses: 0 }
    const amt = toCents(t.amount)
    if (t.type === 'income') map[d].income += amt
    if (t.type === 'expense') map[d].expenses += amt
    if (t.type === 'refund') map[d].expenses -= amt
  }
  return Object.values(map).map(r => ({
    date: r.date,
    income: fromCents(r.income),
    expenses: fromCents(Math.max(0, r.expenses)),
    net: fromCents(r.income - r.expenses)
  }))
}

export async function expenseDistribution(userId, opts = {}) {
  const txs = (await txFilter(userId, opts)).filter(t => t.type === 'expense' || t.type === 'refund')
  const cats = await db.prepare('SELECT * FROM categories WHERE user_id = ?').all(userId)
  const cmap = Object.fromEntries(cats.map(c => [c.id, c]))
  const map = {}
  for (const t of txs) {
    const key = t.category_id || 0
    if (!map[key]) {
      const c = cmap[key]
      map[key] = { categoryId: key, name: c?.name || 'Uncategorized', color: c?.color || '#667085', amount: 0 }
    }
    const amt = toCents(t.amount)
    map[key].amount += t.type === 'refund' ? -amt : amt
  }
  return Object.values(map).filter(x => x.amount > 0).map(x => ({ ...x, amount: fromCents(x.amount) })).sort((a, b) => b.amount - a.amount)
}

export async function financialHealthScore(userId) {
  const nw = await netWorth(userId)
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  const month = periodRange('month')
  const stats = await periodStats(userId, month)
  const debts = await db.prepare("SELECT * FROM debts WHERE user_id = ? AND status IN ('active','overdue')").all(userId)
  const goals = await db.prepare("SELECT * FROM goals WHERE user_id = ? AND status = 'active'").all(userId)
  const budgets = await budgetPerformance(userId, month)

  const breakdown = []
  let score = 0

  // Liquidity 20
  let liq = 10
  if (nw.cash > 0 && nw.debt === 0) liq = 20
  else if (nw.cash > nw.debt * 0.5 && nw.cash > 0) liq = 16
  else if (nw.cash > 0) liq = 12
  else if (nw.cash <= 0 && nw.debt > 0) liq = 2
  else if (nw.cash <= 0) liq = 6
  score += liq
  breakdown.push({ key: 'liquidity', label: 'Liquidity', points: liq, max: 20 })

  // Debt 15
  let debtPts = 15
  if (nw.assets > 0) {
    const ratio = nw.debt / Math.max(nw.assets, 1)
    if (ratio === 0) debtPts = 15
    else if (ratio < 0.2) debtPts = 12
    else if (ratio < 0.4) debtPts = 9
    else if (ratio < 0.7) debtPts = 5
    else debtPts = 2
  } else if (nw.debt > 0) debtPts = 2
  score += debtPts
  breakdown.push({ key: 'debt', label: 'Debt load', points: debtPts, max: 15 })

  // Savings / cash flow 15
  let sav = 8
  if (stats.income > 0) {
    const rate = stats.netCashFlow / stats.income
    if (rate >= 0.3) sav = 15
    else if (rate >= 0.15) sav = 12
    else if (rate >= 0) sav = 9
    else sav = 3
  } else if (stats.expenses > 0) sav = 4
  score += sav
  breakdown.push({ key: 'savings', label: 'Savings rate', points: sav, max: 15 })

  // Spending 10
  let spend = 6
  if (stats.income > 0) {
    const r = stats.expenses / stats.income
    if (r <= 0.5) spend = 10
    else if (r <= 0.75) spend = 8
    else if (r <= 1) spend = 5
    else spend = 2
  }
  score += spend
  breakdown.push({ key: 'spending', label: 'Spending', points: spend, max: 10 })

  // Budget adherence 10
  let bud = 10
  if (budgets.length) {
    const over = budgets.filter(b => b.status === 'exceeded').length
    const near = budgets.filter(b => b.status === 'warning').length
    if (over > 0) bud = 3
    else if (near > 0) bud = 6
    else bud = 10
  } else bud = 6
  score += bud
  breakdown.push({ key: 'budget', label: 'Budget adherence', points: bud, max: 10 })

  // Emergency fund 15
  const target = Number(user.emergency_fund_target) || 0
  let em = 8
  if (target > 0) {
    const r = nw.cash / target
    if (r >= 1) em = 15
    else if (r >= 0.5) em = 10
    else if (r >= 0.25) em = 6
    else em = 2
  } else if (nw.cash > 0) em = 8
  else em = 3
  score += em
  breakdown.push({ key: 'emergency', label: 'Emergency fund', points: em, max: 15 })

  // Income consistency 5
  const months = lastNMonths(3)
  const incomes = []
  for (const p of months) incomes.push((await periodStats(userId, p)).income)
  let cons = 3
  if (incomes.every(i => i > 0)) {
    const avg = incomes.reduce((a, b) => a + b, 0) / incomes.length
    const maxDev = Math.max(...incomes.map(i => Math.abs(i - avg))) / Math.max(avg, 1)
    cons = maxDev < 0.25 ? 5 : maxDev < 0.5 ? 4 : 3
  } else if (incomes.some(i => i > 0)) cons = 2
  else cons = 1
  score += cons
  breakdown.push({ key: 'income_consistency', label: 'Income consistency', points: cons, max: 5 })

  // Net worth trend 10
  const snaps = await db.prepare('SELECT * FROM financial_snapshots WHERE user_id = ? ORDER BY date ASC').all(userId)
  let trend = 5
  if (snaps.length >= 2) {
    const first = snaps[0].net_worth
    const last = snaps[snaps.length - 1].net_worth
    if (last > first) trend = 10
    else if (last === first) trend = 6
    else trend = 3
  } else if (nw.netWorth > 0) trend = 6
  else if (nw.netWorth < 0) trend = 3
  score += trend
  breakdown.push({ key: 'net_worth_trend', label: 'Net-worth trend', points: trend, max: 10 })

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    breakdown,
    label: 'Finance OS indicator',
    disclaimer: 'Internal Finance OS indicator based on liquidity, debt, savings, spending, budget adherence, emergency fund, income consistency and net-worth trend. Not a credit score.'
  }
}

function lastNMonths(n) {
  const { y, m } = maputoYmd()
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i
    let yy = y
    while (mm <= 0) { mm += 12; yy -= 1 }
    out.push({ from: `${yy}-${String(mm).padStart(2, '0')}-01`, to: monthEnd(yy, mm) })
  }
  return out
}

export async function budgetPerformance(userId, range) {
  const budgets = await db.prepare("SELECT * FROM budgets WHERE user_id = ? AND status = 'active'").all(userId)
  const out = []
  for (const b of budgets) {
    let spent = 0
    let sql = `SELECT * FROM transactions WHERE user_id = ? AND type IN ('expense','refund') AND ${LIVE_TX}`
    const params = [userId]
    if (range?.from) { sql += ' AND date >= ?'; params.push(range.from) }
    if (range?.to) { sql += ' AND date <= ?'; params.push(range.to) }
    if (b.category_id) { sql += ' AND category_id = ?'; params.push(b.category_id) }
    if (b.scope === 'personal') sql += ' AND business_id IS NULL'
    if (b.scope === 'business' && b.business_id) { sql += ' AND business_id = ?'; params.push(b.business_id) }
    else if (b.scope === 'business') sql += ' AND business_id IS NOT NULL'
    const txs = await db.prepare(sql).all(...params)
    for (const t of txs) {
      const amt = toCents(t.amount)
      spent += t.type === 'refund' ? -amt : amt
    }
    spent = Math.max(0, spent)
    const remaining = fromCents(toCents(b.amount) - spent)
    const pct = b.amount > 0 ? (spent / toCents(b.amount)) * 100 : 0
    let status = 'ok'
    if (pct >= 100) status = 'exceeded'
    else if (pct >= 80) status = 'warning'
    out.push({ ...b, spent: fromCents(spent), remaining, percent: round2(pct), status })
  }
  return out
}

export async function nextAction(userId) {
  const nw = await netWorth(userId)
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  const month = periodRange('month')
  const stats = await periodStats(userId, month)
  const debts = await db.prepare("SELECT * FROM debts WHERE user_id = ? AND status IN ('active','overdue') ORDER BY interest DESC").all(userId)
  const overdue = await db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'overdue'").all(userId)
  const accounts = await allAccountBalances(userId)
  const goals = await db.prepare("SELECT * FROM goals WHERE user_id = ? AND status = 'active'").all(userId)
  const minLiq = Number(user.min_liquidity) || 0
  const emergencyTarget = Number(user.emergency_fund_target) || 0

  if (accounts.length === 0) {
    return { severity: 'info', title: 'Add your first account', body: 'No accounts yet. Add your first account to start tracking cash, banks and wallets.' }
  }
  const txCount = (await db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND ${LIVE_TX}`).get(userId)).c
  if (txCount === 0) {
    return { severity: 'info', title: 'Record a transaction', body: 'Accounts are ready. Add income or an expense so Finance OS can calculate cash flow.' }
  }
  if (overdue.length) {
    const d = overdue[0]
    return { severity: 'critical', title: 'Overdue debt needs attention', body: `${d.creditor} is overdue with ${fmt(d.current_balance, user.currency)} remaining. Prioritize this payment before new spending.` }
  }
  if (nw.cash <= 0 && debts.length) {
    return { severity: 'critical', title: 'Generate cash before paying down debt', body: `Liquidity is at ${fmt(nw.cash, user.currency)} while ${fmt(nw.debt, user.currency)} of debt is active. Prioritize cash generation, then debt repayment.` }
  }
  if (minLiq > 0 && nw.cash < minLiq) {
    return { severity: 'warning', title: 'Cash below your minimum liquidity', body: `Available cash is ${fmt(nw.cash, user.currency)} versus a ${fmt(minLiq, user.currency)} floor. Pause non-essential spending until cash recovers.` }
  }
  if (nw.cash > 0 && nw.cash < nw.debt * 0.1 && debts.length) {
    return { severity: 'warning', title: 'Thin liquidity vs debt', body: `Cash covers very little of ${fmt(nw.debt, user.currency)} outstanding. Focus on cash generation and the highest-interest debt first.` }
  }
  if (emergencyTarget > 0 && nw.cash < emergencyTarget * 0.25) {
    return { severity: 'warning', title: 'Emergency fund is below target', body: `Cash is ${fmt(nw.cash, user.currency)} against an emergency target of ${fmt(emergencyTarget, user.currency)}. Direct surplus into a savings account.` }
  }
  if (stats.income > 0 && stats.expenses > stats.income) {
    return { severity: 'warning', title: 'Spending exceeds income this period', body: `Expenses ${fmt(stats.expenses, user.currency)} are above income ${fmt(stats.income, user.currency)}. Cut the largest expense categories first.` }
  }
  if (debts.length) {
    const top = debts[0]
    return { severity: 'info', title: `Pay ${top.creditor} next`, body: `Highest-interest active debt is ${top.creditor} at ${top.interest}% with ${fmt(top.current_balance, user.currency)} remaining. Minimum payment ${fmt(top.minimum_payment, user.currency)}.` }
  }
  if (goals.length) {
    const g = goals[0]
    const cur = await goalProgress(userId, g.id)
    const left = Math.max(0, g.target_amount - cur)
    return { severity: 'info', title: `Fund ${g.name}`, body: `${fmt(left, user.currency)} remaining to reach ${g.name}. Surplus cash flow this period is ${fmt(stats.netCashFlow, user.currency)}.` }
  }
  if (stats.netCashFlow > 0) {
    return { severity: 'ok', title: 'Allocate surplus cash', body: `Net cash flow is ${fmt(stats.netCashFlow, user.currency)} this period. Set an allocation rule or move surplus into savings, debt or a goal.` }
  }
  return { severity: 'ok', title: 'Keep recording activity', body: 'Continue logging transactions so Finance OS can refine the next action from real data.' }
}

export async function coachInsights(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  const cur = user.currency
  const insights = []
  const thisMonth = periodRange('month')
  const prev = previousMonth()
  const nowStats = await periodStats(userId, thisMonth)
  const prevStats = await periodStats(userId, prev)
  const nw = await netWorth(userId)

  const cats = await expenseDistribution(userId, thisMonth)
  const prevCats = await expenseDistribution(userId, prev)
  for (const c of cats) {
    const old = prevCats.find(p => p.categoryId === c.categoryId)
    if (old && old.amount > 0) {
      const delta = ((c.amount - old.amount) / old.amount) * 100
      if (Math.abs(delta) >= 15) {
        insights.push({
          type: delta > 0 ? 'warning' : 'positive',
          text: `You spent ${Math.abs(Math.round(delta))}% ${delta > 0 ? 'more' : 'less'} on ${c.name} versus last month (${fmt(c.amount, cur)} vs ${fmt(old.amount, cur)}).`
        })
      }
    }
  }

  const debtsNow = nw.debt
  const prevSnap = await db.prepare('SELECT * FROM financial_snapshots WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1')
    .get(userId, thisMonth.from)
  if (prevSnap) {
    const ddelta = debtsNow - prevSnap.debt
    if (Math.abs(ddelta) >= 1) {
      insights.push({
        type: ddelta < 0 ? 'positive' : 'warning',
        text: ddelta < 0
          ? `Debt decreased by ${fmt(Math.abs(ddelta), cur)}.`
          : `Debt increased by ${fmt(ddelta, cur)}.`
      })
    }
    const nwd = nw.netWorth - prevSnap.net_worth
    if (Math.abs(nwd) >= 1) {
      insights.push({
        type: nwd > 0 ? 'positive' : 'warning',
        text: `Net worth ${nwd > 0 ? 'increased' : 'decreased'} by ${fmt(Math.abs(nwd), cur)}.`
      })
    }
  }

  const emergencyTarget = Number(user.emergency_fund_target) || 0
  if (emergencyTarget > 0 && nw.cash < emergencyTarget) {
    insights.push({ type: 'warning', text: `Emergency fund is below target (${fmt(nw.cash, cur)} vs ${fmt(emergencyTarget, cur)}).` })
  }
  if (nw.cash <= 0) {
    insights.push({ type: 'critical', text: 'Liquidity is critically low.' })
  } else if (Number(user.min_liquidity) > 0 && nw.cash < Number(user.min_liquidity)) {
    insights.push({ type: 'critical', text: `Liquidity is below your minimum of ${fmt(user.min_liquidity, cur)}.` })
  }

  if (nowStats.income > 0 && prevStats.income > 0) {
    const d = ((nowStats.income - prevStats.income) / prevStats.income) * 100
    if (Math.abs(d) >= 10) {
      insights.push({
        type: d > 0 ? 'positive' : 'warning',
        text: `Income is ${Math.abs(Math.round(d))}% ${d > 0 ? 'higher' : 'lower'} than last month.`
      })
    }
  }

  const overdue = (await db.prepare("SELECT COUNT(*) AS c FROM debts WHERE user_id = ? AND status = 'overdue'").get(userId)).c
  if (overdue) insights.push({ type: 'critical', text: `${overdue} debt${overdue > 1 ? 's are' : ' is'} overdue.` })

  const upcoming = await db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'active' AND due_date IS NOT NULL AND due_date <= date('now','+7 day')").all(userId)
  for (const d of upcoming) {
    insights.push({ type: 'warning', text: `${d.creditor} payment is due ${d.due_date} (${fmt(d.minimum_payment || d.current_balance, cur)}).` })
  }

  if (!insights.length) {
    const txCount = (await db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND ${LIVE_TX}`).get(userId)).c
    if (!txCount) insights.push({ type: 'info', text: 'No transactions yet. Insights appear after you record real activity.' })
    else insights.push({ type: 'info', text: 'Not enough period-over-period change to flag. Keep recording transactions.' })
  }
  return insights
}

function previousMonth() {
  const { y, m } = maputoYmd()
  let mm = m - 1
  let yy = y
  if (mm <= 0) { mm = 12; yy -= 1 }
  return { from: `${yy}-${String(mm).padStart(2, '0')}-01`, to: monthEnd(yy, mm) }
}

export async function affordability(userId, amount) {
  const amt = Number(amount) || 0
  const nw = await netWorth(userId)
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  const month = periodRange('month')
  const stats = await periodStats(userId, month)
  const budgets = await budgetPerformance(userId, month)
  const debts = await db.prepare("SELECT * FROM debts WHERE user_id = ? AND status IN ('active','overdue')").all(userId)
  const upcoming = debts.reduce((s, d) => s + (Number(d.minimum_payment) || 0), 0)
  const goals = await db.prepare("SELECT * FROM goals WHERE user_id = ? AND status = 'active'").all(userId)
  const minLiq = Number(user.min_liquidity) || 0
  const emergencyTarget = Number(user.emergency_fund_target) || 0
  const reasons = []
  let status = 'affordable'

  if (amt <= 0) return { status: 'not_recommended', label: 'Not recommended', reasons: ['Enter a purchase amount greater than zero.'] }

  const cashAfter = nw.cash - amt
  if (nw.cash < amt) {
    status = 'not_recommended'
    reasons.push(`Available cash is ${fmt(nw.cash, user.currency)}, which is less than ${fmt(amt, user.currency)}.`)
  }
  if (cashAfter < upcoming) {
    status = 'not_recommended'
    reasons.push(`After this purchase, cash would be ${fmt(cashAfter, user.currency)} versus ${fmt(upcoming, user.currency)} in upcoming minimum debt payments.`)
  }
  if (minLiq > 0 && cashAfter < minLiq) {
    status = 'not_recommended'
    reasons.push(`This would drop cash below your minimum liquidity of ${fmt(minLiq, user.currency)}.`)
  }
  if (emergencyTarget > 0 && cashAfter < emergencyTarget * 0.25 && status !== 'not_recommended') {
    status = 'caution'
    reasons.push(`Emergency fund would fall to ${fmt(cashAfter, user.currency)} against a ${fmt(emergencyTarget, user.currency)} target.`)
  }
  const overall = budgets.find(b => b.scope === 'overall')
  if (overall && overall.spent + amt > overall.amount) {
    if (status !== 'not_recommended') status = 'caution'
    reasons.push(`This exceeds the overall budget remaining of ${fmt(overall.remaining, user.currency)}.`)
  }
  if (goals.length && status === 'affordable') {
    const g = goals[0]
    const left = Math.max(0, g.target_amount - await goalProgress(userId, g.id))
    if (amt > 0 && left > 0 && amt >= left * 0.2) {
      status = 'caution'
      reasons.push(`Spending ${fmt(amt, user.currency)} slows progress toward ${g.name} (${fmt(left, user.currency)} remaining).`)
    }
  }
  if (stats.income > 0 && stats.expenses + amt > stats.income && status === 'affordable') {
    status = 'caution'
    reasons.push('This purchase would push expenses above income for the current period.')
  }
  if (!reasons.length) {
    reasons.push(`Cash of ${fmt(nw.cash, user.currency)} covers ${fmt(amt, user.currency)} without breaching debt payments, liquidity floor, or budget limits.`)
  }
  const labels = { affordable: 'Affordable', caution: 'Affordable but slows a goal', not_recommended: 'Not recommended' }
  return { status, label: labels[status], reasons, cash: nw.cash, cashAfter, upcomingPayments: upcoming }
}

export async function applyAllocation(userId, amount, ruleId) {
  const rule = await db.prepare('SELECT * FROM allocation_rules WHERE id = ? AND user_id = ?').get(ruleId, userId)
  if (!rule) throw new Error('Rule not found')
  const splits = JSON.parse(rule.splits || '[]')
  const totalPct = splits.reduce((s, x) => s + Number(x.percent || 0), 0)
  if (Math.abs(totalPct - 100) > 0.01) throw new Error('Split percentages must total 100')
  const amt = Number(amount)
  return splits.map(s => ({
    label: s.label,
    accountId: s.accountId || null,
    percent: Number(s.percent),
    amount: round2(amt * Number(s.percent) / 100)
  }))
}

export async function businessSummary(userId, businessId, opts = {}) {
  const b = await db.prepare('SELECT * FROM businesses WHERE id = ? AND user_id = ?').get(businessId, userId)
  if (!b) return null
  const stats = await periodStats(userId, { ...opts, businessId })
  const accounts = (await allAccountBalances(userId)).filter(a => sameId(a.business_id, businessId))
  const linkedCash = fromCents(accounts.reduce((s, a) => s + toCents(a.balance), 0))
  const allBizTx = await txFilter(userId, { businessId })
  let opCents = 0
  for (const t of allBizTx) {
    const amt = toCents(t.amount)
    if (t.type === 'income' || t.type === 'owner_contribution' || t.type === 'refund') opCents += amt
    if (t.type === 'expense' || t.type === 'owner_draw') opCents -= amt
  }
  const cash = accounts.length ? linkedCash : fromCents(opCents)
  const txs = await txFilter(userId, { ...opts, businessId })
  return { ...b, ...stats, cash, linkedCash, operatingCash: fromCents(opCents), accounts, transactions: txs.slice(0, 20) }
}

export function round2(n) {
  return fromCents(toCents(n))
}

export function fmt(n, currency = 'MZN') {
  try {
    return new Intl.NumberFormat('en-MZ', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n) || 0)
  } catch {
    return `${round2(n)} ${currency}`
  }
}

export { txFilter }
