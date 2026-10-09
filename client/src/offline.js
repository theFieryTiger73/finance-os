const DB_NAME = 'finance-os'
const DB_VER = 1

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache')
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore(name, mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode)
    const store = tx.objectStore(name)
    let result
    try { result = fn(store) } catch (e) { reject(e); return }
    tx.oncomplete = () => {
      if (result && typeof result.then === 'function') result.then(resolve, reject)
      else resolve(result)
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function cacheGet(key) {
  return withStore('cache', 'readonly', store => {
    return new Promise((resolve, reject) => {
      const r = store.get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  })
}

export async function cachePut(key, value) {
  return withStore('cache', 'readwrite', store => { store.put(value, key) })
}

export async function cacheClear() {
  return withStore('cache', 'readwrite', store => { store.clear() })
}

export async function cacheClearPrefix(prefix) {
  return withStore('cache', 'readwrite', store => {
    return new Promise((resolve, reject) => {
      const r = store.openCursor()
      r.onsuccess = () => {
        const c = r.result
        if (!c) return resolve()
        if (String(c.key).startsWith(prefix)) c.delete()
        c.continue()
      }
      r.onerror = () => reject(r.error)
    })
  })
}

export async function queueAdd(item) {
  await withStore('queue', 'readwrite', store => { store.put(item) })
  emit()
}

export async function queueAll() {
  return withStore('queue', 'readonly', store => {
    return new Promise((resolve, reject) => {
      const r = store.getAll()
      r.onsuccess = () => resolve(r.result || [])
      r.onerror = () => reject(r.error)
    })
  })
}

export async function queueRemove(id) {
  await withStore('queue', 'readwrite', store => { store.delete(id) })
  emit()
}

export async function queueUpdate(item) {
  await withStore('queue', 'readwrite', store => { store.put(item) })
  emit()
}

export async function pendingCount() {
  const rows = await queueAll().catch(() => [])
  return rows.filter(r => r.status !== 'failed').length
}

export function newClientId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

export function isNetworkError(err) {
  if (!err) return false
  if (err.network) return true
  const msg = String(err.message || err)
  return !isOnline() || /failed to fetch|networkerror|load failed|offline|could not reach the server/i.test(msg)
}

function emit() {
  window.dispatchEvent(new Event('fos-offline'))
}

export async function formToPayload(form) {
  const obj = {}
  for (const [k, v] of form.entries()) {
    if (v instanceof File) {
      if (v.size && v.size < 1.5 * 1024 * 1024) {
        obj[k] = { __file: true, name: v.name, type: v.type, data: await fileToDataUrl(v) }
      }
    } else obj[k] = v
  }
  return obj
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export function payloadToForm(obj) {
  const fd = new FormData()
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v && v.__file && v.data) {
      const bin = dataUrlToBlob(v.data, v.type)
      fd.append(k, new File([bin], v.name || 'file', { type: v.type || bin.type }))
    } else if (v != null && v !== '') fd.append(k, v)
  })
  return fd
}

function dataUrlToBlob(dataUrl, type) {
  const parts = String(dataUrl).split(',')
  const b64 = parts[1] || ''
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: type || 'application/octet-stream' })
}

export function optimisticFrom(path, method, body, formObj, clientId) {
  const src = formObj || body || {}
  const now = new Date().toISOString()
  const base = {
    id: `pending:${clientId}`,
    _pending: true,
    client_id: clientId,
    created_at: now,
    updated_at: now
  }
  if (path.startsWith('/transactions')) {
    return {
      ...base,
      amount: Number(src.amount) || 0,
      date: src.date,
      type: src.type,
      account_id: src.accountId || src.account_id || null,
      to_account_id: src.toAccountId || src.to_account_id || null,
      category_id: src.categoryId || src.category_id || null,
      business_id: src.businessId || src.business_id || null,
      debt_id: src.debtId || src.debt_id || null,
      goal_id: src.goalId || src.goal_id || null,
      description: src.description || '',
      notes: src.notes || '',
      tags: src.tags || '',
      voided_at: method === 'DELETE' ? now : null
    }
  }
  return { ...base, ...src, name: src.name || src.creditor || src.description || 'Pending' }
}

const MUTATION_PREFIXES = ['/transactions', '/accounts', '/businesses', '/debts', '/goals', '/budgets', '/categories', '/recurring', '/me', '/notifications', '/onboarding']

export function canQueue(path, method) {
  if (method === 'GET') return false
  if (path.startsWith('/auth')) return false
  if (path.startsWith('/data/')) return false
  if (path.startsWith('/me/password')) return false
  return MUTATION_PREFIXES.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'))
}

function pendingFor(path, q) {
  const extras = []
  for (const item of q) {
    if (item.status === 'failed' || item.method !== 'POST' || !item.optimistic) continue
    const base = item.path.split('?')[0]
    const match =
      (path.startsWith('/transactions') && base === '/transactions') ||
      (path.startsWith('/accounts') && base === '/accounts') ||
      (path.startsWith('/debts') && base === '/debts') ||
      (path.startsWith('/goals') && base === '/goals') ||
      (path.startsWith('/businesses') && base === '/businesses')
    if (match) extras.push(item.optimistic)
  }
  return extras
}

export async function mergePending(path, data) {
  const q = await queueAll().catch(() => [])
  if (data && typeof data === 'object' && !Array.isArray(data) && path.startsWith('/dashboard')) {
    const extras = pendingFor('/transactions', q)
    if (!extras.length) return data
    const ids = new Set((data.recent || []).map(r => r.client_id).filter(Boolean))
    return { ...data, recent: [...extras.filter(e => !ids.has(e.client_id)), ...(data.recent || [])].slice(0, 12) }
  }
  if (!Array.isArray(data)) return data
  const extras = pendingFor(path, q)
  if (!extras.length) return data
  const ids = new Set(data.map(r => r.client_id).filter(Boolean))
  return [...extras.filter(e => e && !ids.has(e.client_id)), ...data]
}
