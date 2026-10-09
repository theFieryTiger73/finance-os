import {
  queueAll, queueRemove, queueUpdate, cacheClearPrefix, payloadToForm, isOnline, isNetworkError
} from './offline.js'
import { getToken, readApiResponse } from './api.js'

let flushing = false

async function send(item) {
  const headers = { Authorization: getToken() ? `Bearer ${getToken()}` : '' }
  if (item.clientId) headers['Idempotency-Key'] = item.clientId
  let payload
  if (item.form) {
    payload = payloadToForm(item.form)
    if (item.clientId) payload.append('clientId', item.clientId)
  } else if (item.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify({ ...item.body, clientId: item.clientId })
  }
  let res
  try {
    res = await fetch(`/api${item.path}`, { method: item.method, headers, body: payload })
  } catch (e) {
    const err = new Error(
      !isOnline()
        ? 'You appear to be offline. Check your connection and try again.'
        : 'Could not reach the server. Check your connection and try again.'
    )
    err.network = true
    err.cause = e
    throw err
  }
  return readApiResponse(res)
}

export async function flushQueue() {
  if (flushing || !isOnline() || !getToken()) return { flushed: 0, failed: 0 }
  flushing = true
  let flushed = 0
  let failed = 0
  try {
    const items = (await queueAll()).sort((a, b) => a.createdAt - b.createdAt)
    for (const item of items) {
      if (item.status === 'failed' && item.tries > 8) continue
      try {
        await send(item)
        await queueRemove(item.id)
        flushed += 1
      } catch (e) {
        if (isNetworkError(e) || e.status === 408 || e.status >= 500) {
          await queueUpdate({ ...item, tries: (item.tries || 0) + 1, lastError: e.message })
          break
        }
        await queueUpdate({ ...item, status: 'failed', lastError: e.message, tries: (item.tries || 0) + 1 })
        failed += 1
      }
    }
    if (flushed) {
      await cacheClearPrefix('/dashboard')
      await cacheClearPrefix('/accounts')
      await cacheClearPrefix('/transactions')
      await cacheClearPrefix('/reports')
      await cacheClearPrefix('/debts')
      await cacheClearPrefix('/goals')
      await cacheClearPrefix('/businesses')
      await cacheClearPrefix('/budgets')
      window.dispatchEvent(new Event('fos-refresh'))
    }
    window.dispatchEvent(new Event('fos-offline'))
  } finally {
    flushing = false
  }
  return { flushed, failed }
}

export function startSync() {
  window.addEventListener('online', () => { flushQueue() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushQueue() })
  setInterval(() => { if (isOnline()) flushQueue() }, 12000)
  flushQueue()
}
