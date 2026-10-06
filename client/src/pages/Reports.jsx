import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, money } from '../api.js'
import { Empty } from '../components.jsx'

export default function Reports({ user }) {
  const [period, setPeriod] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [r, setR] = useState(null)
  const c = user.currency
  async function load() {
    const q = new URLSearchParams({ period })
    if (period === 'custom' && from && to) { q.set('from', from); q.set('to', to) }
    setR(await api(`/reports?${q}`))
  }
  useEffect(() => { load() }, [period, from, to])
  if (!r) return <p className="sub">Loading reports…</p>
  return (
    <>
      <h2>Reports</h2>
      <p className="sub">Income, expenses, cash flow, net worth, debt, budget and business profitability.</p>
      <div className="filters">
        {[['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['custom', 'Custom']].map(([v, l]) => (
          <button key={v} className={`chip ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
        ))}
        {period === 'custom' && <><input type="date" className="chip" value={from} onChange={e => setFrom(e.target.value)} /><input type="date" className="chip" value={to} onChange={e => setTo(e.target.value)} /></>}
      </div>
      <div className="grid kpis">
        <div className="card kpi"><div className="label">Income</div><div className="value pos">{money(r.stats.income, c)}</div></div>
        <div className="card kpi"><div className="label">Expenses</div><div className="value neg">{money(r.stats.expenses, c)}</div></div>
        <div className="card kpi"><div className="label">Cash flow</div><div className="value">{money(r.stats.netCashFlow, c)}</div></div>
        <div className="card kpi"><div className="label">Business profit</div><div className="value">{money(r.stats.businessProfit, c)}</div></div>
      </div>
      <div className="grid cards-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h3>Cash flow</h3>
          {r.cashFlow.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={r.cashFlow}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" hide /><YAxis /><Tooltip /><Bar dataKey="income" fill="#12b76a" /><Bar dataKey="expenses" fill="#f04438" /></BarChart>
            </ResponsiveContainer>
          ) : <Empty title="No movement in this period." />}
        </div>
        <div className="card">
          <h3>Net worth</h3>
          {r.netWorthHistory.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={r.netWorthHistory}><XAxis dataKey="date" hide /><YAxis /><Tooltip /><Line type="monotone" dataKey="net_worth" stroke="#2e90fa" /></LineChart>
            </ResponsiveContainer>
          ) : <Empty title="Net-worth history appears after snapshots are recorded." />}
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Category analysis</h3>
        {r.expenses.length ? r.expenses.map(e => (
          <div key={e.categoryId} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}><span>{e.name}</span><span>{money(e.amount, c)}</span></div>
        )) : <Empty title="No categorized expenses yet." />}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Budget performance</h3>
        {r.budgets.length ? r.budgets.map(b => (
          <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}><span>{b.name}</span><span>{money(b.spent, c)} / {money(b.amount, c)}</span></div>
        )) : <Empty title="No budgets to report." />}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Business profitability</h3>
        {r.businesses.length ? r.businesses.map(b => (
          <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}><span>{b.name}</span><span>{money(b.businessProfit, c)}</span></div>
        )) : <Empty title="No businesses yet." />}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Debt progress</h3>
        {r.debts.length ? r.debts.map(d => (
          <div key={d.id} className="row" style={{ justifyContent: 'space-between' }}><span>{d.creditor}</span><span>{money(d.current_balance, c)} remaining</span></div>
        )) : <Empty title="No debts recorded." />}
      </div>
    </>
  )
}
