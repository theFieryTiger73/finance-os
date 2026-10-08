import { DatabaseSync } from 'node:sqlite'

const BASE = process.env.BASE || 'http://127.0.0.1:5173'

async function req(path, { method = 'GET', token, body, form, clientId } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (clientId) headers['Idempotency-Key'] = clientId
  let payload
  if (form) payload = form
  else if (body) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(clientId ? { ...body, clientId } : body)
  }
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${data.error || 'fail'}`)
  return data
}

const email = `leonel.${Date.now()}@example.com`
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const auth = await req('/auth/register', { method: 'POST', body: {
  firstName: 'Leonel', lastName: 'Test', email, password: 'password12', country: 'MZ', currency: 'MZN'
}})
if (auth.user.brandName !== "Leonel's Finance OS") throw new Error('brand name mismatch: ' + auth.user.brandName)
const t = auth.token
await req('/onboarding', { method: 'PUT', token: t, body: { step: 5, completed: true, firstName: 'Leonel', currency: 'MZN' } })

const acc1 = await req('/accounts', { method: 'POST', token: t, body: { name: 'M-Pesa', type: 'mobile_money', initialBalance: 2000, currency: 'MZN' } })
const acc2 = await req('/accounts', { method: 'POST', token: t, body: { name: 'Bank', type: 'bank', initialBalance: 5000, currency: 'MZN' } })
if (acc1.balance !== 2000) throw new Error('mpesa initial ' + acc1.balance)
if (acc2.balance !== 5000) throw new Error('bank initial ' + acc2.balance)

const fd = new FormData()
fd.append('name', 'Academy')
fd.append('type', 'education')
fd.append('brandColor', '#7A5AF8')
const biz = await req('/businesses', { method: 'POST', token: t, form: fd })

const income = new FormData()
income.append('type', 'income'); income.append('amount', '5000'); income.append('date', today())
income.append('accountId', String(acc1.id)); income.append('description', 'Salary'); income.append('businessId', '')
const tx = await req('/transactions', { method: 'POST', token: t, form: income })

const accounts = await req('/accounts', { token: t })
const mpesa = accounts.find(a => a.name === 'M-Pesa')
if (mpesa.balance !== 7000) throw new Error('income did not increase cash: ' + mpesa.balance)

const transfer = new FormData()
transfer.append('type', 'transfer'); transfer.append('amount', '1000'); transfer.append('date', today())
transfer.append('accountId', String(acc1.id)); transfer.append('toAccountId', String(acc2.id)); transfer.append('description', 'M-Pesa to Bank')
await req('/transactions', { method: 'POST', token: t, form: transfer })
const afterT = await req('/accounts', { token: t })
const m2 = afterT.find(a => a.name === 'M-Pesa').balance
const b2 = afterT.find(a => a.name === 'Bank').balance
if (m2 !== 6000) throw new Error('transfer from failed ' + m2)
if (b2 !== 6000) throw new Error('transfer to failed ' + b2)
const dash = await req('/dashboard', { token: t })
if (dash.stats.income !== 5000) throw new Error('transfer counted as income')
if (dash.netWorth.cash !== 12000) throw new Error('net cash after transfer ' + dash.netWorth.cash)

const debt = await req('/debts', { method: 'POST', token: t, body: { creditor: 'Bank loan', originalAmount: 3000, interest: 12, minimumPayment: 500 } })
const pay = new FormData()
pay.append('type', 'debt_payment'); pay.append('amount', '500'); pay.append('date', today())
pay.append('accountId', String(acc2.id)); pay.append('debtId', String(debt.id)); pay.append('description', 'Loan payment')
await req('/transactions', { method: 'POST', token: t, form: pay })
const debts = await req('/debts', { token: t })
if (debts[0].current_balance !== 2500) throw new Error('debt not reduced ' + debts[0].current_balance)
const afterP = await req('/accounts', { token: t })
if (afterP.find(a => a.name === 'Bank').balance !== 5500) throw new Error('payment did not reduce cash')

const goal = await req('/goals', { method: 'POST', token: t, body: { name: 'Emergency', targetAmount: 10000, currentAmount: 1000 } })
if (goal.target_amount !== 10000) throw new Error('goal missing')

const expense = new FormData()
expense.append('type', 'expense'); expense.append('amount', '200'); expense.append('date', today())
expense.append('accountId', String(acc1.id)); expense.append('description', 'Transport')
const ex = await req('/transactions', { method: 'POST', token: t, form: expense })
const edit = new FormData()
edit.append('type', 'expense'); edit.append('amount', '300'); edit.append('date', today())
edit.append('accountId', String(acc1.id)); edit.append('description', 'Transport')
await req(`/transactions/${ex.id}`, { method: 'PUT', token: t, form: edit })
const afterE = await req('/accounts', { token: t })
if (afterE.find(a => a.name === 'M-Pesa').balance !== 5700) throw new Error('edit recalc failed ' + afterE.find(a => a.name === 'M-Pesa').balance)

const recPersonal = await req('/recurring', { method: 'POST', token: t, body: {
  type: 'expense', amount: 100, frequency: 'monthly', startDate: today(), accountId: acc1.id, description: 'Internet', businessId: ''
}})
if (recPersonal.business_id) throw new Error('personal recurring linked to business')
const recBiz = await req('/recurring', { method: 'POST', token: t, body: {
  type: 'expense', amount: 250, frequency: 'monthly', startDate: today(), accountId: acc1.id, description: 'Office rent', businessId: biz.id
}})
if (Number(recBiz.business_id) !== Number(biz.id)) throw new Error('business recurring missing business')
const recList = await req('/recurring?businessId=personal', { token: t })
if (!recList.some(r => r.id === recPersonal.id) || recList.some(r => r.id === recBiz.id)) throw new Error('personal recurring filter failed')
await req(`/recurring/${recPersonal.id}/confirm`, { method: 'POST', token: t, body: {} })
const afterRec = await req('/accounts', { token: t })
if (afterRec.find(a => a.name === 'M-Pesa').balance !== 5600) throw new Error('confirm recurring did not post expense')

const reports = await req('/reports', { token: t })
if (reports.stats.expenses !== 400) throw new Error('report expenses ' + reports.stats.expenses)

const user2 = await req('/auth/register', { method: 'POST', body: {
  firstName: 'Ana', lastName: 'Other', email: `ana.${Date.now()}@example.com`, password: 'password12', currency: 'MZN'
}})
const idemKey = `smoke-${Date.now()}`
const idemBody = { name: 'Idem Wallet', type: 'cash', initialBalance: 10, currency: 'MZN' }
const i1 = await req('/accounts', { method: 'POST', token: t, body: idemBody, clientId: idemKey })
const i2 = await req('/accounts', { method: 'POST', token: t, body: idemBody, clientId: idemKey })
if (i1.id !== i2.id) throw new Error('idempotency failed')

const leak = await fetch(`${BASE}/api/accounts`, { headers: { Authorization: `Bearer ${user2.token}` } }).then(r => r.json())
if (leak.some(a => a.name === 'M-Pesa')) throw new Error('user isolation failed')
if (user2.user.brandName !== "Ana's Finance OS") throw new Error('second user brand')

console.log('SMOKE OK', {
  brand: auth.user.brandName,
  mpesa: afterE.find(a => a.name === 'M-Pesa').balance,
  bank: afterE.find(a => a.name === 'Bank').balance,
  debt: debts[0].current_balance,
  income: dash.stats.income,
  expenses: reports.stats.expenses,
  recurring: recPersonal.id
})
