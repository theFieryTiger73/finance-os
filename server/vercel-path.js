function header(req, name) {
  const h = req.headers || {}
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? String(h[key] || '') : ''
}

function uriPath(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s)
      return u.pathname + u.search
    }
  } catch { /* use as path */ }
  return s.startsWith('/') ? s : '/' + s
}

function splitUrl(url) {
  const s = String(url || '/')
  const q = s.indexOf('?')
  return q >= 0 ? { pathname: s.slice(0, q), search: s.slice(q + 1) } : { pathname: s, search: '' }
}

const REWRITE_TARGETS = new Set([
  '/api', '/api/', '/api/index', '/api/index.js', '/api/router', '/api/router.js'
])

function fromFosPath(current) {
  const params = new URLSearchParams(current.search)
  const fos = params.get('fosPath')
  if (!fos) return null
  params.delete('fosPath')
  const rest = params.toString()
  const pathPart = decodeURIComponent(String(fos)).replace(/^\/+/, '')
  return '/api/' + pathPart + (rest ? '?' + rest : '')
}

function fromForwarded(req, current) {
  const forwarded = uriPath(
    header(req, 'x-forwarded-uri') ||
    header(req, 'x-original-uri') ||
    header(req, 'x-invoke-path') ||
    header(req, 'x-vercel-original-path') ||
    header(req, 'x-rewrite-url')
  )
  if (!forwarded.startsWith('/api/')) return null
  const rewritten = REWRITE_TARGETS.has(current.pathname)
  const fwd = splitUrl(forwarded)
  if (rewritten && !REWRITE_TARGETS.has(fwd.pathname)) return forwarded
  return null
}

export function applyOriginalApiPath(req) {
  const current = splitUrl(req.url || '/')
  const restored = fromFosPath(current) || fromForwarded(req, current)
  if (restored) {
    req.url = restored
    return restored
  }
  if (req.url && !String(req.url).startsWith('/api')) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    const p = q ? req.url.slice(0, req.url.indexOf('?')) : req.url
    req.url = '/api' + (p.startsWith('/') ? p : '/' + p) + q
  }
  return req.url
}
