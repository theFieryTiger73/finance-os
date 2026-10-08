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
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
  })
}

export async function cacheGet(key) {
  return withStore('cache', 'readonly', store => new Promise((resolve, reject) => {
    const r = store.get(key)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}

export async function cachePut(key, value) {
  return withStore('cache', 'readwrite', store => { store.put(value, key) })
}
