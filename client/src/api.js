const TOKEN_KEY = 'financeos_token'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) }

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { Authorization: getToken() ? `Bearer ${getToken()}` : '' }
  let payload
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const money = (n, currency = 'MZN') => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(n) || 0)
  } catch {
    return `${(Number(n) || 0).toFixed(2)} ${currency}`
  }
}

export const ACCOUNT_TYPES = [
  ['cash', 'Cash'], ['bank', 'Bank'], ['mobile_money', 'Mobile Money'], ['savings', 'Savings'],
  ['credit_card', 'Credit Card'], ['digital_wallet', 'Digital Wallet'], ['investment', 'Investment'], ['other', 'Other']
]
export const BIZ_TYPES = [
  ['education', 'Education'], ['ecommerce', 'E-commerce'], ['agency', 'Agency'], ['retail', 'Retail'],
  ['services', 'Services'], ['technology', 'Technology'], ['consulting', 'Consulting'], ['other', 'Other']
]
export const TX_TYPES = [
  ['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer'], ['debt_payment', 'Debt Payment'],
  ['owner_draw', 'Owner Draw'], ['owner_contribution', 'Owner Contribution'], ['investment', 'Investment'],
  ['refund', 'Refund'], ['adjustment', 'Adjustment']
]
export const COUNTRIES = ['MZ', 'ZA', 'PT', 'US', 'GB', 'BR', 'AO', 'TZ', 'KE', 'NG']
export const CURRENCIES = ['MZN', 'USD', 'EUR', 'ZAR', 'GBP', 'BRL']

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || 'B'
}

export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
