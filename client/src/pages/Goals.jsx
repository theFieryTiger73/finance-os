import { useEffect, useState } from 'react'
import { api, money } from '../api.js'
import { Empty, Field, Modal, Progress } from '../components.jsx'

export default function Goals({ user }) {
  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const c = user.currency

  async function load() {
    setRows(await api('/goals'))
    setAccounts(await api('/accounts'))
  }
  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      if (form.id) await api(`/goals/${form.id}`, { method: 'PUT', body: form })
      else await api('/goals', { method: 'POST', body: form })
      setForm(null); load()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Goals</h2><p className="sub">Unlimited savings and funding targets.</p></div>
        <button className="btn" onClick={() => setForm({ name: '', targetAmount: '', currentAmount: 0, targetDate: '', priority: 'medium', notes: '' })}>+ Add Goal</button>
      </div>
      {rows.length ? (
        <div className="grid cards-2">
          {rows.map(g => (
            <div key={g.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{g.name}</strong>
                <span className="pill goal">{g.priority}</span>
              </div>
              <p className="sub">{money(g.current, c)} of {money(g.target_amount, c)} · {money(g.remaining, c)} remaining · {g.target_date || 'no date'}</p>
              <Progress pct={g.percent} kind="goal" />
              <button className="btn ghost sm" onClick={() => setForm({ ...g, targetAmount: g.target_amount, currentAmount: g.current_amount, targetDate: g.target_date, accountId: g.account_id })}>Edit</button>
            </div>
          ))}
        </div>
      ) : <Empty title="No goals yet. Add your first goal." action="+ Add Goal" onAction={() => setForm({ name: '', targetAmount: '', currentAmount: 0, priority: 'medium' })} />}
      {form && (
        <Modal title={form.id ? 'Edit goal' : 'Add goal'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Target amount"><input type="number" step="0.01" required value={form.targetAmount} onChange={e => setForm({ ...form, targetAmount: e.target.value })} /></Field>
            <Field label="Current amount"><input type="number" step="0.01" value={form.currentAmount} onChange={e => setForm({ ...form, currentAmount: e.target.value })} /></Field>
            <Field label="Target date"><input type="date" value={form.targetDate || ''} onChange={e => setForm({ ...form, targetDate: e.target.value })} /></Field>
            <Field label="Linked account">
              <select value={form.accountId || ''} onChange={e => setForm({ ...form, accountId: e.target.value })}>
                <option value="">None (manual progress)</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Priority"><select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option>high</option><option>medium</option><option>low</option></select></Field>
            <Field label="Notes"><textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            {err && <div className="err">{err}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </>
  )
}
