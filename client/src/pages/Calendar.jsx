import { useEffect, useState } from 'react'
import { api, today } from '../api.js'
import { Empty, Modal, RecurringForm, RecurringList, useLookups } from '../components.jsx'

export default function CalendarPage({ user }) {
  const [ym, setYm] = useState(() => today().slice(0, 7))
  const [data, setData] = useState({ events: [] })
  const [rec, setRec] = useState([])
  const [form, setForm] = useState(null)
  const lookups = useLookups()

  async function load() {
    const [y, m] = ym.split('-').map(Number)
    const from = `${ym}-01`
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const to = `${ym}-${String(last).padStart(2, '0')}`
    setData(await api(`/calendar?from=${from}&to=${to}`))
    setRec(await api('/recurring'))
  }
  useEffect(() => { load() }, [ym])

  const [y, m] = ym.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = Array.from({ length: first }, () => null).concat(Array.from({ length: days }, (_, i) => i + 1))

  async function saveRec(body) {
    await api('/recurring', { method: 'POST', body })
    setForm(null); load()
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Calendar</h2><p className="sub">Expected vs confirmed. Recurring items stay expected until you confirm them.</p></div>
        <div className="row">
          <input type="month" value={ym} onChange={e => setYm(e.target.value)} />
          <button className="btn" onClick={() => setForm({ type: 'expense', frequency: 'monthly', startDate: `${ym}-01` })}>+ Recurring expense</button>
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
                <div key={n} className={`ev ${e.status === 'confirmed' ? 'confirmed' : 'expected'}`}>{e.title}</div>
              ))}
            </div>
          )
        })}
      </div>
      <RecurringList
        rows={rec}
        currency={user.currency}
        businesses={lookups.businesses}
        onAdd={() => setForm({ type: 'expense', frequency: 'monthly', startDate: `${ym}-01` })}
        onConfirm={async r => { await api(`/recurring/${r.id}/confirm`, { method: 'POST', body: {} }); load(); window.dispatchEvent(new Event('fos-refresh')) }}
        onPause={async r => { await api(`/recurring/${r.id}`, { method: 'PUT', body: { status: 'paused' } }); load() }}
        onResume={async r => { await api(`/recurring/${r.id}`, { method: 'PUT', body: { status: 'active' } }); load() }}
      />
      {form && (
        <Modal title="Add recurring expense" onClose={() => setForm(null)}>
          <RecurringForm {...lookups} initial={form} onSave={saveRec} onCancel={() => setForm(null)} />
        </Modal>
      )}
    </>
  )
}
