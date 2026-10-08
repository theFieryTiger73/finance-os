import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, money, initials } from '../api.js'
import { Empty, Money, Modal, RecurringForm, RecurringList, useLookups } from '../components.jsx'

export default function BusinessDetail({ user }) {
  const { id } = useParams()
  const [b, setB] = useState(null)
  const [rec, setRec] = useState([])
  const [form, setForm] = useState(null)
  const lookups = useLookups()
  const c = user.currency
  async function load() {
    setB(await api(`/businesses/${id}`))
    setRec(await api(`/recurring?businessId=${id}`))
  }
  useEffect(() => { load() }, [id])
  if (!b) return <p className="sub">Loading business…</p>
  return (
    <>
      <Link to="/businesses" className="sub">Back to businesses</Link>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="avatar" style={{ background: b.brand_color, width: 56, height: 56 }}>{b.logo ? <img src={b.logo} alt="" /> : initials(b.name)}</div>
        <div>
          <h2>{b.name}</h2>
          <p className="sub">{b.type} · {b.status} · {b.description || 'No description'}</p>
        </div>
      </div>
      <div className="grid kpis">
        <div className="card kpi"><div className="label">Revenue</div><div className="value pos">{money(b.businessRevenue, c)}</div></div>
        <div className="card kpi"><div className="label">Expenses</div><div className="value neg">{money(b.businessExpenses, c)}</div></div>
        <div className="card kpi"><div className="label">Profit</div><div className="value"><Money value={b.businessProfit} currency={c} signed /></div></div>
        <div className="card kpi"><div className="label">Cash</div><div className="value">{money(b.cash, c)}</div><div className="sub">{b.accounts?.length ? 'From linked accounts' : 'Operating cash from business transactions (no linked accounts)'}</div></div>
        <div className="card kpi"><div className="label">Owner draws</div><div className="value">{money(b.ownerDraws, c)}</div></div>
        <div className="card kpi"><div className="label">Owner contributions</div><div className="value">{money(b.ownerContributions, c)}</div></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Accounts</h3>
        {b.accounts?.length ? b.accounts.map(a => (
          <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}><span>{a.name}</span><span>{money(a.balance, c)}</span></div>
        )) : <Empty title="No accounts linked to this business yet." />}
      </div>
      <RecurringList
        rows={rec}
        currency={c}
        businesses={lookups.businesses}
        onAdd={() => setForm({ type: 'expense', frequency: 'monthly', businessId: id })}
        onConfirm={async r => { await api(`/recurring/${r.id}/confirm`, { method: 'POST', body: {} }); load(); window.dispatchEvent(new Event('fos-refresh')) }}
        onPause={async r => { await api(`/recurring/${r.id}`, { method: 'PUT', body: { status: 'paused' } }); load() }}
        onResume={async r => { await api(`/recurring/${r.id}`, { method: 'PUT', body: { status: 'active' } }); load() }}
      />
      {form && (
        <Modal title={`Recurring expense · ${b.name}`} onClose={() => setForm(null)}>
          <RecurringForm {...lookups} lockBusiness={id} initial={form} onSave={async body => { await api('/recurring', { method: 'POST', body: { ...body, businessId: id } }); setForm(null); load() }} onCancel={() => setForm(null)} />
        </Modal>
      )}
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Transactions</h3>
        {b.transactions?.length ? b.transactions.map(t => (
          <div key={t.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{t.date} · {t.type} · {t.description}</span><span>{money(t.amount, c)}</span>
          </div>
        )) : <Empty title="No business transactions yet." />}
      </div>
    </>
  )
}
