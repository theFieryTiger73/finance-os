import { useEffect, useState } from 'react'
import { api, money } from '../api.js'
import { Empty, Field, Modal, Progress, RecurringForm, RecurringList, useLookups } from '../components.jsx'

export default function Budget({ user }) {
  const [rows, setRows] = useState([])
  const [cats, setCats] = useState([])
  const [biz, setBiz] = useState([])
  const [form, setForm] = useState(null)
  const [recForm, setRecForm] = useState(null)
  const [rec, setRec] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const lookups = useLookups()
  const c = user.currency

  async function load() {
    setRows(await api('/budgets'))
    setCats(await api('/categories'))
    setBiz(await api('/businesses'))
    setRec(await api('/recurring?businessId=personal'))
  }
  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      if (form.id) await api(`/budgets/${form.id}`, { method: 'PUT', body: form })
      else await api('/budgets', { method: 'POST', body: form })
      setForm(null); load()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Budget</h2><p className="sub">Limits plus personal recurring bills (rent, internet, subscriptions).</p></div>
        <button className="btn" onClick={() => setForm({ name: '', scope: 'overall', amount: '', period: 'monthly' })}>+ Add Budget</button>
      </div>
      {rows.length ? rows.map(b => (
        <div key={b.id} className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{b.name}</strong>
            <span className={`pill ${b.status === 'exceeded' ? 'bad' : b.status === 'warning' ? 'warn' : 'ok'}`}>{b.status}</span>
          </div>
          <p className="sub">{b.scope} · {money(b.spent, c)} spent of {money(b.amount, c)} · {money(b.remaining, c)} remaining</p>
          <Progress pct={b.percent} kind={b.status === 'exceeded' ? 'bad' : b.status === 'warning' ? 'warn' : 'ok'} />
          <button className="btn ghost sm" onClick={() => setForm({ ...b, categoryId: b.category_id, businessId: b.business_id })}>Edit</button>
        </div>
      )) : <Empty title="No budgets yet. Add your first budget." action="+ Add Budget" onAction={() => setForm({ name: '', scope: 'overall', amount: '', period: 'monthly' })} />}
      <RecurringList
        rows={rec}
        currency={c}
        businesses={lookups.businesses}
        onAdd={() => setRecForm({ type: 'expense', frequency: 'monthly' })}
        onConfirm={async r => { await api(`/recurring/${r.id}/confirm`, { method: 'POST', body: {} }); load(); window.dispatchEvent(new Event('fos-refresh')) }}
        onPause={async r => { await api(`/recurring/${r.id}`, { method: 'PUT', body: { status: 'paused' } }); load() }}
        onResume={async r => { await api(`/recurring/${r.id}`, { method: 'PUT', body: { status: 'active' } }); load() }}
      />
      {recForm && (
        <Modal title="Personal recurring expense" onClose={() => setRecForm(null)}>
          <RecurringForm {...lookups} lockBusiness="" initial={{ ...recForm, businessId: '' }} onSave={async body => { await api('/recurring', { method: 'POST', body: { ...body, businessId: '' } }); setRecForm(null); load() }} onCancel={() => setRecForm(null)} />
        </Modal>
      )}
      {form && (
        <Modal title={form.id ? 'Edit budget' : 'Add budget'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Scope">
              <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}>
                <option value="overall">Overall</option><option value="personal">Personal</option>
                <option value="business">Business</option><option value="category">Category</option>
              </select>
            </Field>
            {form.scope === 'business' && (
              <Field label="Business"><select value={form.businessId || ''} onChange={e => setForm({ ...form, businessId: e.target.value })}><option value="">All businesses</option>{biz.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            )}
            {(form.scope === 'category' || form.categoryId) && (
              <Field label="Category"><select value={form.categoryId || ''} onChange={e => setForm({ ...form, categoryId: e.target.value })}><option value="">None</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            )}
            <Field label="Amount"><input type="number" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Period"><select value={form.period} onChange={e => setForm({ ...form, period: e.target.value })}><option>monthly</option><option>quarterly</option><option>yearly</option></select></Field>
            {err && <div className="err">{err}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </>
  )
}
