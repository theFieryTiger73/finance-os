import { sqliteToPg } from './pg.js'
import { applyOriginalApiPath } from './vercel-path.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(sqliteToPg("INSERT OR IGNORE INTO t (a) VALUES (?)").includes('ON CONFLICT DO NOTHING'), 'ignore')
assert(sqliteToPg("SELECT MAX(0, current_amount + ?)").includes('GREATEST(0,'), 'greatest')
assert(sqliteToPg("datetime('now')").includes('timezone'), 'now')
assert(sqliteToPg("date('now','+7 day')").includes("interval '7 day'"), 'date+7')
assert(sqliteToPg('excluded.net_worth').includes('EXCLUDED.net_worth'), 'excluded')
assert(sqliteToPg('a=? AND b=?') === 'a=$1 AND b=$2', 'placeholders')

const req = { url: '/api/router?fosPath=auth/login', headers: {} }
assert(applyOriginalApiPath(req) === '/api/auth/login', 'fosPath login')
const req2 = { url: '/api/router?fosPath=accounts/1/transactions&x=1', headers: {} }
assert(applyOriginalApiPath(req2) === '/api/accounts/1/transactions?x=1', 'fosPath nested qs')
const req3 = { url: '/api/router', headers: { 'x-forwarded-uri': '/api/auth/register' } }
assert(applyOriginalApiPath(req3) === '/api/auth/register', 'forwarded uri')
const req4 = { url: '/auth/login', headers: {} }
assert(applyOriginalApiPath(req4) === '/api/auth/login', 'missing prefix')

console.log('ok')
