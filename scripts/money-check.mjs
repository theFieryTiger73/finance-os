import { toCents, fromCents, parseMoney, sameId, asId, isIsoDate } from '../server/money.js'

function eq(a, b, label) {
  if (a !== b) throw new Error(`${label}: ${a} !== ${b}`)
}

eq(toCents(0.1) + toCents(0.2), toCents(0.3), '0.1+0.2 cents')
eq(fromCents(toCents(4402.1)), 4402.1, 'round trip')
eq(parseMoney('5000'), 5000, 'parse 5000')
eq(parseMoney(0, { allowZero: true }), 0, 'zero allowed')
eq(sameId('12', 12), true, 'sameId')
eq(sameId(null, 1), false, 'sameId null')
eq(asId('3'), 3, 'asId')
eq(asId('x'), null, 'asId invalid')
eq(isIsoDate('2026-10-07'), true, 'iso date')
eq(isIsoDate('07-10-2026'), false, 'bad date')

let threw = false
try { parseMoney(-1) } catch { threw = true }
if (!threw) throw new Error('negative money should fail')
threw = false
try { parseMoney(0) } catch { threw = true }
if (!threw) throw new Error('zero money should fail without allowZero')

console.log('MONEY OK')
