import { useEffect, useState } from 'react'
import { api, money } from '../api.js'
import { Empty, Field, Modal, Progress, TxForm, useLookups } from '../components.jsx'

export default function Debts({ user }) {
  const [rows, setRows] = useState([])
  const [sort, setSort] = useState('interest')
  const [form, setForm] = useState(null)
  const [pay, setPay] = useState(null)
  const lookups = useLookups()
  const c = user.currency

  async function load() { setRows(await api(`/debts?sort=${sort}`)) }
  useEffect(() => { load() }, [sort])

  async function save(e) {
    e.preventDefault()
    if (form.id) await api(`/debts/${form.id}`, { method: 'PUT', body: form })
    else await api('/debts', { method: 'POST', body: form })
    setForm(null); load()
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Debts</h2><p className="sub">Payments reduce balances automatically. Transfers never count as income or expense.</p></div>
        <button className="btn" onClick={() => setForm({ creditor: '', originalAmount: '', currentBalance: '', interest: 0, dueDate: '', minimumPayment: 0, priority: 'medium', notes: '', status: 'active' })}>+ Add Debt</button>
      </div>
      <div className="filters">
        {[['interest', 'Highest interest'], ['balance', 'Smallest debt'], ['due', 'Earliest due'], ['custom', 'Priority']].map(([v, l]) => (
          <button key={v} className={`chip ${sort === v ? 'active' : ''}`} onClick={() => setSort(v)}>{l}</button>
        ))}
      </div>
      {rows.length ? rows.map(d => (
        <div key={d.id} className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{d.creditor}</strong>
            <span className={`pill ${d.status === 'overdue' ? 'bad' : d.status === 'paid' ? 'ok' : 'info'}`}>{d.status}</span>
          </div>
          <p className="sub">Original {money(d.original_amount, c)} · Paid {money(d.paid, c)} · Remaining {money(d.remaining, c)} · {d.interest}% · due {d.due_date || '—'}</p>
          <Progress pct={d.percent} kind={d.status === 'paid' ? 'ok' : 'bad'} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => setPay(d)}>Record payment</button>
            <button className="btn sm secondary" onClick={() => setForm({ ...d, originalAmount: d.original_amount, currentBalance: d.current_balance, dueDate: d.due_date, minimumPayment: d.minimum_payment, accountId: d.account_id })}>Edit</button>
          </div>
        </div>
      )) : <Empty title="No debts yet. Add a creditor only if you actually owe money." action="+ Add Debt" onAction={() => setForm({ creditor: '', originalAmount: '', interest: 0, status: 'active', priority: 'medium' })} />}
      {form && (
        <Modal title={form.id ? 'Edit debt' : 'Add debt'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Creditor"><input required value={form.creditor} onChange={e => setForm({ ...form, creditor: e.target.value })} /></Field>
            <Field label="Original amount"><input type="number" step="0.01" required value={form.originalAmount} onChange={e => setForm({ ...form, originalAmount: e.target.value })} /></Field>
            {!form.id && <Field label="Current balance"><input type="number" step="0.01" value={form.currentBalance} onChange={e => setForm({ ...form, currentBalance: e.target.value })} /></Field>}
            <Field label="Interest %"><input type="number" step="0.01" value={form.interest} onChange={e => setForm({ ...form, interest: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" value={form.dueDate || ''} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
            <Field label="Minimum payment"><input type="number" step="0.01" value={form.minimumPayment} onChange={e => setForm({ ...form, minimumPayment: e.target.value })} /></Field>
            <Field label="Priority"><select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option>high</option><option>medium</option><option>low</option></select></Field>
            <Field label="Status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option>active</option><option>paid</option><option>overdue</option><option>archived</option></select></Field>
            <Field label="Notes"><textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <button className="btn">Save</button>
          </form>
        </Modal>
      )}
      {pay && (
        <Modal title={`Pay ${pay.creditor}`} onClose={() => setPay(null)}>
          <TxForm {...lookups} initial={{ type: 'debt_payment', debt_id: pay.id, amount: pay.minimum_payment || '' }} onSave={async fd => { await api('/transactions', { method: 'POST', form: fd }); setPay(null); load() }} onCancel={() => setPay(null)} />
        </Modal>
      )}
    </>
  )
}
