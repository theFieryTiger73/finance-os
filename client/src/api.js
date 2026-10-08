import {
  cacheGet, cachePut, queueAdd, newClientId, isOnline, isNetworkError,
  formToPayload, canQueue, mergePending, optimisticFrom
} from './offline.js'

const TOKEN_KEY = 'financeos_token'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(t) {
  if (t) {
    localStorage.setItem(TOKEN_KEY, t)
    document.cookie = `fos_token=${encodeURIComponent(t)}; path=/; SameSite=Lax; max-age=${14 * 24 * 3600}`
  } else {
    localStorage.removeItem(TOKEN_KEY)
    document.cookie = 'fos_token=; path=/; max-age=0'
  }
}

async function rawFetch(path, { method = 'GET', body, form, clientId } = {}) {
  const headers = { Authorization: getToken() ? `Bearer ${getToken()}` : '' }
  if (clientId) headers['Idempotency-Key'] = clientId
  let payload
  if (form) {
    payload = form
    if (clientId && !payload.get('clientId')) payload.append('clientId', clientId)
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(clientId ? { ...body, clientId } : body)
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed')
    err.status = res.status
    throw err
  }
  return data
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const m = (method || 'GET').toUpperCase()
  if (m === 'GET') {
    try {
      const data = await rawFetch(path, { method: m })
      cachePut(path, data).catch(() => {})
      return mergePending(path, data)
    } catch (e) {
      if (isNetworkError(e) || !isOnline()) {
        const cached = await cacheGet(path)
        if (cached !== undefined) return mergePending(path, cached)
      }
      throw e
    }
  }
  const clientId = newClientId()
  try {
    return await rawFetch(path, { method: m, body, form, clientId })
  } catch (e) {
    if (canQueue(path, m) && (isNetworkError(e) || !isOnline())) {
      const formObj = form ? await formToPayload(form) : null
      const item = {
        id: clientId,
        clientId,
        path,
        method: m,
        body: form ? undefined : (body || {}),
        form: formObj,
        optimistic: optimisticFrom(path, m, body, formObj, clientId),
        createdAt: Date.now(),
        tries: 0,
        status: 'queued'
      }
      await queueAdd(item)
      window.dispatchEvent(new Event('fos-refresh'))
      return item.optimistic || { ok: true, queued: true, clientId }
    }
    throw e
  }
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
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}
