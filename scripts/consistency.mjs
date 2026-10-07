const BASE = process.env.BASE || 'http://127.0.0.1:5173'

async function req(path, { method = 'GET', token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${data.error || 'fail'}`)
  return data
}

function today() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}

function eq(actual, expected, label) {
  if (Number(actual) !== Number(expected)) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}

const stamp = Date.now()
const date = today()

const auth = await req('/auth/register', {
  method: 'POST',
  body: { firstName: 'Audit', lastName: 'Case', email: `audit.${stamp}@example.com`, password: 'password12', country: 'MZ', currency: 'MZN' }
})
const t = auth.token
if (auth.user.brandName !== "Audit's Finance OS") throw new Error('brand ' + auth.user.brandName)
await req('/onboarding', { method: 'PUT', token: t, body: { step: 5, completed: true } })

const mpesa = await req('/accounts', { method: 'POST', token: t, body: { name: 'M-Pesa', type: 'mobile_money', initialBalance: 2, currency: 'MZN' } })
eq(mpesa.balance, 2, 'mpesa opening')

const income = new FormData()
income.append('type', 'income'); income.append('amount', '5000'); income.append('date', date)
income.append('accountId', String(mpesa.id)); income.append('description', 'Salary')
await req('/transactions', { method: 'POST', token: t, form: income })

const expense = new FormData()
expense.append('type', 'expense'); expense.append('amount', '100'); expense.append('date', date)
expense.append('accountId', String(mpesa.id)); expense.append('description', 'Airtime')
await req('/transactions', { method: 'POST', token: t, form: expense })

const debt = await req('/debts', { method: 'POST', token: t, body: { creditor: 'Loan', originalAmount: 5940, currentBalance: 5940, interest: 10, minimumPayment: 500 } })
eq(debt.current_balance, 5940, 'debt opening')

const pay = new FormData()
pay.append('type', 'debt_payment'); pay.append('amount', '500'); pay.append('date', date)
pay.append('accountId', String(mpesa.id)); pay.append('debtId', String(debt.id)); pay.append('description', 'Loan payment')
await req('/transactions', { method: 'POST', token: t, form: pay })

const accounts = await req('/accounts', { token: t })
const dash = await req('/dashboard', { token: t })
const debts = await req('/debts', { token: t })
eq(accounts.find(a => a.name === 'M-Pesa').balance, 4402, 'cash after income/expense/debt payment')
eq(dash.netWorth.cash, 4402, 'dashboard cash')
eq(debts[0].remaining, 5440, 'debt remaining')
eq(dash.netWorth.debt, 5440, 'dashboard debt')
eq(dash.stats.income, 5000, 'income excludes debt payment')
eq(dash.stats.expenses, 100, 'expense excludes debt payment')
eq(dash.stats.debtPayments, 500, 'debt payments tracked separately')

const over = new FormData()
over.append('type', 'debt_payment'); over.append('amount', '6000'); over.append('date', date)
over.append('accountId', String(mpesa.id)); over.append('debtId', String(debt.id))
let overpayBlocked = false
try { await req('/transactions', { method: 'POST', token: t, form: over }) }
catch (e) { overpayBlocked = String(e.message).includes('exceed') }
if (!overpayBlocked) throw new Error('overpay was not blocked')

const a = await req('/accounts', { method: 'POST', token: t, body: { name: 'Wallet A', type: 'cash', initialBalance: 1000 } })
const b = await req('/accounts', { method: 'POST', token: t, body: { name: 'Wallet B', type: 'bank', initialBalance: 500 } })
const nwBefore = (await req('/dashboard', { token: t })).netWorth
const tr = new FormData()
tr.append('type', 'transfer'); tr.append('amount', '300'); tr.append('date', date)
tr.append('accountId', String(a.id)); tr.append('toAccountId', String(b.id)); tr.append('description', 'A to B')
await req('/transactions', { method: 'POST', token: t, form: tr })
const after = await req('/accounts', { token: t })
eq(after.find(x => x.name === 'Wallet A').balance, 700, 'transfer from')
eq(after.find(x => x.name === 'Wallet B').balance, 800, 'transfer to')
const nwAfter = (await req('/dashboard', { token: t })).netWorth
eq(nwAfter.cash, nwBefore.cash, 'transfer does not change net cash')
eq(nwAfter.netWorth, nwBefore.netWorth, 'transfer does not change net worth')
const stats = (await req('/dashboard', { token: t })).stats
eq(stats.income, 5000, 'transfer is not income')
eq(stats.expenses, 100, 'transfer is not expense')

const ana = await req('/auth/register', {
  method: 'POST',
  body: { firstName: 'Ana', lastName: 'Other', email: `ana.cons.${stamp}@example.com`, password: 'password12', currency: 'MZN' }
})
if (ana.user.brandName !== "Ana's Finance OS") throw new Error('ana brand')
const leak = await req('/accounts', { token: ana.token })
if (leak.some(x => x.name === 'M-Pesa')) throw new Error('user isolation failed')
const fileLeak = await fetch(`${BASE}/uploads/logos/nope.png`)
if (fileLeak.status === 200) throw new Error('public uploads still exposed')

console.log('CONSISTENCY OK', {
  cash: 4402,
  debt: 5440,
  transfer: '700/800',
  isolation: true
})
