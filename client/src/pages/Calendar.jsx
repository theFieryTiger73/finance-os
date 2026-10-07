import { useEffect, useState } from 'react'
import { api, money, today } from '../api.js'
import { Empty, Field, Modal } from '../components.jsx'

export default function CalendarPage({ user }) {
  const [ym, setYm] = useState(() => today().slice(0, 7))
  const [data, setData] = useState({ events: [] })
  const [rec, setRec] = useState([])
  const [form, setForm] = useState(null)
  const [accounts, setAccounts] = useState([])

  async function load() {
    const [y, m] = ym.split('-').map(Number)
    const from = `${ym}-01`
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const to = `${ym}-${String(last).padStart(2, '0')}`
    setData(await api(`/calendar?from=${from}&to=${to}`))
    setRec(await api('/recurring'))
    setAccounts(await api('/accounts'))
  }
  useEffect(() => { load() }, [ym])

  const [y, m] = ym.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = Array.from({ length: first }, () => null).concat(Array.from({ length: days }, (_, i) => i + 1))

  async function saveRec(e) {
    e.preventDefault()
    await api('/recurring', { method: 'POST', body: form })
    setForm(null); load()
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Calendar</h2><p className="sub">Expected vs confirmed. Recurring items stay expected until you confirm them.</p></div>
        <div className="row">
          <input type="month" value={ym} onChange={e => setYm(e.target.value)} />
          <button className="btn" onClick={() => setForm({ amount: '', frequency: 'monthly', startDate: `${ym}-01`, type: 'expense', description: '', accountId: accounts[0]?.id || '' })}>+ Recurring</button>
        </div>
      </div>
      <div className="cal">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <strong key={d} style={{ fontSize: 12, color: 'var(--muted)' }}>{d}</strong>)}
        {cells.map((d, i) => {
          const date = d ? `${ym}-${String(d).padStart(2, '0')}` : null
          const evs = date ? data.events.filter(e => e.date === date) : []
          return (
            <div key={i} className="day">
              {d}
              {evs.map((e, n) => (
                <div key={n} className={`ev ${e.status === 'confirmed' ? 'confirmed' : 'expected'}`}>{e.title} · {e.status}</div>
              ))}
            </div>
          )
        })}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recurring</h3>
        {rec.length ? rec.map(r => (
          <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div>{r.description || r.type} · {r.frequency}</div>
              <div className="sub">Next {r.next_date} · expected {money(r.amount, user.currency)}</div>
            </div>
            {r.status === 'active' && <button className="btn sm" onClick={async () => { await api(`/recurring/${r.id}/confirm`, { method: 'POST', body: {} }); load() }}>Confirm</button>}
          </div>
        )) : <Empty title="No recurring items yet." />}
      </div>
      {form && (
        <Modal title="Add recurring" onClose={() => setForm(null)}>
          <form className="form" onSubmit={saveRec}>
            <Field label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option>income</option><option>expense</option><option>debt_payment</option><option>transfer</option></select></Field>
            <Field label="Amount"><input type="number" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Frequency"><select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}><option>weekly</option><option>biweekly</option><option>monthly</option><option>yearly</option></select></Field>
            <Field label="Start date"><input type="date" required value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="Account"><select value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="Description"><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
            <button className="btn">Save</button>
          </form>
        </Modal>
      )}
    </>
  )
}
