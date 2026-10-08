import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, money, initials } from '../api.js'
import { Empty, Money, Progress } from '../components.jsx'

export default function Dashboard({ user }) {
  const [d, setD] = useState(null)
  const [period, setPeriod] = useState('month')
  const [scope, setScope] = useState('all')
  const [businessId, setBusinessId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [affordAmt, setAffordAmt] = useState('')
  const [afford, setAfford] = useState(null)

  async function load() {
    const q = new URLSearchParams({ period, scope })
    if (businessId) q.set('businessId', businessId)
    if (period === 'custom' && from && to) { q.set('from', from); q.set('to', to) }
    setD(await api(`/dashboard?${q}`))
  }
  useEffect(() => { load() }, [period, scope, businessId, from, to])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('fos-refresh', h)
    return () => window.removeEventListener('fos-refresh', h)
  }, [period, scope, businessId, from, to])

  if (!d) return <p className="sub">Loading dashboard…</p>
  const c = user.currency
  const nw = d.netWorth
  const s = d.stats
  const action = d.nextAction
  const health = d.health

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>{user.brandName}</h2>
          <p className="sub">Personal CFO view · {d.range.from} to {d.range.to}</p>
        </div>
      </div>
      <div className="filters">
        {[['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['custom', 'Custom']].map(([v, l]) => (
          <button key={v} className={`chip ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
        ))}
        {[['all', 'All'], ['personal', 'Personal'], ['business', 'Business']].map(([v, l]) => (
          <button key={v} className={`chip ${scope === v ? 'active' : ''}`} onClick={() => { setScope(v); setBusinessId('') }}>{l}</button>
        ))}
        {d.businesses.map(b => (
          <button key={b.id} className={`chip ${businessId == b.id ? 'active' : ''}`} onClick={() => { setScope('all'); setBusinessId(String(b.id)) }}>{b.name}</button>
        ))}
        {period === 'custom' && (
          <>
            <input type="date" className="chip" value={from} onChange={e => setFrom(e.target.value)} />
            <input type="date" className="chip" value={to} onChange={e => setTo(e.target.value)} />
          </>
        )}
      </div>
      <div className="grid kpis">
        <div className="card kpi"><div className="label">Net Worth</div><div className="value"><Money value={nw.netWorth} currency={c} signed /></div></div>
        <div className="card kpi"><div className="label">Available Cash</div><div className="value">{money(nw.cash, c)}</div></div>
        <div className="card kpi"><div className="label">Total Debt</div><div className="value neg">{money(nw.debt, c)}</div></div>
        <div className="card kpi"><div className="label">Income</div><div className="value pos">{money(s.income, c)}</div></div>
        <div className="card kpi"><div className="label">Expenses</div><div className="value neg">{money(s.expenses, c)}</div></div>
        <div className="card kpi"><div className="label">Net Cash Flow</div><div className="value"><Money value={s.netCashFlow} currency={c} signed /></div></div>
        <div className="card kpi"><div className="label">Business Profit</div><div className="value"><Money value={s.businessProfit} currency={c} signed /></div></div>
        <div className="card kpi">
          <div className="label">Goals Progress</div>
          <div className="value">{d.goals.length ? `${Math.round(d.goals.reduce((a, g) => a + Math.min(100, g.percent), 0) / d.goals.length)}%` : '—'}</div>
        </div>
      </div>
      <div className="grid cards-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Next action</h3>
          <span className={`pill ${action.severity === 'critical' ? 'bad' : action.severity === 'warning' ? 'warn' : action.severity === 'ok' ? 'ok' : 'info'}`}>{action.severity}</span>
          <p style={{ fontWeight: 700, margin: '10px 0 4px' }}>{action.title}</p>
          <p className="sub">{action.body}</p>
        </div>
        <div className="card row" style={{ alignItems: 'center', gap: 16 }}>
          <div>
            <h3>Financial Health Score</h3>
            <div style={{ fontSize: 36, fontWeight: 700 }}>{health.score}</div>
            <div className="pill info">{health.label}</div>
            <p className="sub" style={{ marginTop: 8 }}>{health.disclaimer}</p>
          </div>
          <div style={{ flex: 1 }}>
            {health.breakdown.map(b => (
              <div key={b.key} style={{ marginBottom: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>{b.label}</span><span>{b.points}/{b.max}</span></div>
                <Progress pct={(b.points / b.max) * 100} kind={b.points / b.max >= 0.7 ? 'ok' : b.points / b.max >= 0.4 ? 'warn' : 'bad'} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid cards-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Cash flow</h3>
          {d.cashFlow.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d.cashFlow}>
                <XAxis dataKey="date" hide /><YAxis hide /><Tooltip />
                <Area type="monotone" dataKey="income" stroke="#12b76a" fill="#ecfdf3" />
                <Area type="monotone" dataKey="expenses" stroke="#f04438" fill="#fef3f2" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Empty title="No cash-flow activity in this period." />}
        </div>
        <div className="card">
          <h3>Expense distribution</h3>
          {d.expenses.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={d.expenses} dataKey="amount" nameKey="name" innerRadius={50} outerRadius={80}>
                  {d.expenses.map(e => <Cell key={e.categoryId} fill={e.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty title="No expenses recorded yet." />}
        </div>
      </div>
      <div className="grid cards-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Can I afford this?</h3>
          <form className="row" onSubmit={async e => { e.preventDefault(); setAfford(await api('/afford', { method: 'POST', body: { amount: affordAmt } })) }}>
            <input type="number" step="0.01" min="0" placeholder="Purchase amount" value={affordAmt} onChange={e => setAffordAmt(e.target.value)} />
            <button className="btn sm">Evaluate</button>
          </form>
          {afford && (
            <div style={{ marginTop: 12 }}>
              <span className={`pill ${afford.status === 'affordable' ? 'ok' : afford.status === 'caution' ? 'warn' : 'bad'}`}>{afford.label}</span>
              <ul>{afford.reasons.map((r, i) => <li key={i} className="sub">{r}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="card">
          <h3>Recent transactions</h3>
          {d.recent.length ? d.recent.map(t => (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', opacity: t._pending ? 0.7 : 1 }}>
              <div>
                <div>{t.description || t.type}{t._pending ? ' · pending' : ''}</div>
                <div className="sub">{t.date} · {t.type}</div>
              </div>
              <Money value={['expense', 'debt_payment', 'owner_draw', 'transfer'].includes(t.type) && t.type !== 'transfer' ? -t.amount : t.type === 'income' || t.type === 'refund' || t.type === 'owner_contribution' ? t.amount : t.amount} currency={c} signed />
            </div>
          )) : <Empty title="No transactions yet. Add your first income or expense." />}
          <Link to="/transactions" className="sub">View all</Link>
        </div>
      </div>
      <div className="grid cards-3" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Accounts</h3>
          {d.accounts.length ? d.accounts.map(a => (
            <div key={a.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
              <span>{a.name}</span><span>{money(a.balance, a.currency || c)}</span>
            </div>
          )) : <Empty title="No accounts yet. Add your first account." />}
        </div>
        <div className="card">
          <h3>Debts</h3>
          {d.debts.length ? d.debts.map(x => (
            <div key={x.id} style={{ marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>{x.creditor}</span><span className="neg">{money(x.current_balance, c)}</span></div>
              <Progress pct={x.original_amount ? ((x.original_amount - x.current_balance) / x.original_amount) * 100 : 0} kind="bad" />
            </div>
          )) : <Empty title="No debts yet." />}
        </div>
        <div className="card">
          <h3>Goals</h3>
          {d.goals.length ? d.goals.map(g => (
            <div key={g.id} style={{ marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>{g.name}</span><span>{Math.round(g.percent)}%</span></div>
              <Progress pct={g.percent} kind="goal" />
            </div>
          )) : <Empty title="No goals yet. Add your first goal." />}
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Businesses</h3>
        {d.businesses.length ? (
          <div className="grid cards-3">
            {d.businesses.map(b => (
              <Link key={b.id} to={`/businesses/${b.id}`} className="card" style={{ boxShadow: 'none' }}>
                <div className="row">
                  <div className="avatar" style={{ background: b.brand_color || '#7A5AF8' }}>
                    {b.logo ? <img src={b.logo} alt="" /> : initials(b.name)}
                  </div>
                  <div>
                    <strong>{b.name}</strong>
                    <div className="sub">{b.status}</div>
                  </div>
                </div>
                <div className="sub" style={{ marginTop: 8 }}>Revenue {money(b.revenue, c)} · Profit <Money value={b.profit} currency={c} signed /></div>
              </Link>
            ))}
          </div>
        ) : <Empty title="No businesses yet. Add your first business." />}
      </div>
    </>
  )
}
