export function toCents(n) {
  if (n === '' || n == null) return 0
  const x = typeof n === 'string' ? Number(n.trim()) : Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 100)
}

export function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100
}

export function sameId(a, b) {
  if (a == null || b == null || a === '' || b === '') return false
  return Number(a) === Number(b)
}

export function asId(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

export function parseMoney(n, { allowNegative = false, allowZero = false, field = 'Amount' } = {}) {
  if (n === '' || n == null) {
    if (allowZero) return 0
    throw new Error(`${field} is required`)
  }
  const x = Number(n)
  if (!Number.isFinite(x)) throw new Error(`${field} is invalid`)
  if (!allowNegative && x < 0) throw new Error(`${field} cannot be negative`)
  if (!allowNegative && !allowZero && x <= 0) throw new Error(`${field} must be greater than zero`)
  if (allowNegative && x === 0 && !allowZero) throw new Error(`${field} cannot be zero`)
  if (Math.abs(x) > 1e12) throw new Error(`${field} is too large`)
  return fromCents(toCents(x))
}

export function isoDate(d = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Maputo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d)
  } catch {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}

export function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
