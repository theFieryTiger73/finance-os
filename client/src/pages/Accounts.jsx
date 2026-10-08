import { useEffect, useState } from 'react'
import { api, money, ACCOUNT_TYPES } from '../api.js'
import { Empty, Field, Modal } from '../components.jsx'

const blank = { name: '', type: 'bank', provider: '', currency: 'MZN', initialBalance: 0, icon: 'wallet', color: '#2E90FA', notes: '', status: 'active' }

export default function Accounts({ user }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [history, setHistory] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const c = user.currency

  async function load() { setRows(await api('/accounts')) }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('fos-refresh', h)
    return () => window.removeEventListener('fos-refresh', h)
  }, [])

  async function save(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      if (form.id) await api(`/accounts/${form.id}`, { method: 'PUT', body: form })
      else await api('/accounts', { method: 'POST', body: form })
      setForm(null); load()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Accounts</h2><p className="sub">Unlimited cash, bank, mobile money, savings and investment accounts.</p></div>
        <button className="btn" onClick={() => setForm({ ...blank, currency: user.currency })}>+ Add Account</button>
      </div>
      {rows.length ? (
        <div className="grid cards-3">
          {rows.map(a => (
            <div key={a.id} className={`card ${a._pending ? 'pending-row' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{a.name}{a._pending ? ' · pending' : ''}</strong>
                <span className="pill info">{String(a.type || '').replace('_', ' ')}</span>
              </div>
              <div className="kpi"><div className="value">{money(a.balance, a.currency || c)}</div></div>
              <p className="sub">{a.provider || 'No provider'} · {a.status}</p>
              <div className="row">
                {!a._pending && <button className="btn sm secondary" onClick={() => setForm({ ...a, initialBalance: a.initial_balance, businessId: a.business_id })}>Edit</button>}
                {!a._pending && <button className="btn sm secondary" onClick={async () => setHistory(await api(`/accounts/${a.id}/transactions`))}>History</button>}
                {!a._pending && a.status !== 'archived' && <button className="btn sm ghost" onClick={async () => { await api(`/accounts/${a.id}/archive`, { method: 'POST' }); load() }}>Archive</button>}
              </div>
            </div>
          ))}
        </div>
      ) : <Empty title="No accounts yet. Add your first account." action="+ Add Account" onAction={() => setForm({ ...blank, currency: user.currency })} />}
      {form && (
        <Modal title={form.id ? 'Edit account' : 'Add account'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{ACCOUNT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Provider"><input value={form.provider || ''} onChange={e => setForm({ ...form, provider: e.target.value })} /></Field>
            <Field label="Currency"><input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></Field>
            <Field label="Initial balance"><input type="number" step="0.01" value={form.initialBalance} onChange={e => setForm({ ...form, initialBalance: e.target.value })} /></Field>
            <Field label="Color"><input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} /></Field>
            <Field label="Notes"><textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option>active</option><option>archived</option></select></Field>
            {err && <div className="err">{err}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        </Modal>
      )}
      {history && (
        <Modal title={`${history.account.name} history`} onClose={() => setHistory(null)}>
          <p className="sub">Balance {money(history.account.balance, history.account.currency || c)}</p>
          {history.transactions.length ? history.transactions.map(t => (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{t.date} · {t.type} · {t.description}</span><span>{money(t.amount, c)}</span>
            </div>
          )) : <Empty title="No transactions on this account yet." />}
        </Modal>
      )}
    </>
  )
}
