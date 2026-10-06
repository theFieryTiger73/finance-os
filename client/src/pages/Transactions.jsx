import { useEffect, useState } from 'react'
import { api, money, TX_TYPES } from '../api.js'
import { Empty, Modal, TxForm, useLookups } from '../components.jsx'

export default function Transactions({ user }) {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const lookups = useLookups()
  const c = user.currency
  const accName = id => lookups.accounts.find(a => a.id === id)?.name || '—'
  const catName = id => lookups.categories.find(x => x.id === id)?.name || '—'

  async function load() {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (type) p.set('type', type)
    setRows(await api(`/transactions?${p}`))
  }
  useEffect(() => { load() }, [q, type])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('fos-refresh', h)
    return () => window.removeEventListener('fos-refresh', h)
  }, [q, type])

  async function save(form) {
    if (editing) await api(`/transactions/${editing.id}`, { method: 'PUT', form })
    else await api('/transactions', { method: 'POST', form })
    setEditing(null); setCreating(false); load(); window.dispatchEvent(new Event('fos-refresh'))
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Transactions</h2><p className="sub">Income, expenses, transfers and owner movements.</p></div>
        <button className="btn" onClick={() => setCreating(true)}>+ Add Transaction</button>
      </div>
      <div className="filters">
        <input className="chip" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        <button className={`chip ${!type ? 'active' : ''}`} onClick={() => setType('')}>All</button>
        {TX_TYPES.map(([v, l]) => <button key={v} className={`chip ${type === v ? 'active' : ''}`} onClick={() => setType(v)}>{l}</button>)}
      </div>
      <div className="card table-wrap">
        {rows.length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Account</th><th>Category</th><th>Amount</th><th></th></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.type}</td>
                  <td>{t.description || '—'}{t.attachment ? ' · file' : ''}</td>
                  <td>{accName(t.account_id)}{t.to_account_id ? ` → ${accName(t.to_account_id)}` : ''}</td>
                  <td>{catName(t.category_id)}</td>
                  <td className={t.type === 'income' || t.type === 'refund' || t.type === 'owner_contribution' ? 'pos' : t.type === 'transfer' ? '' : 'neg'}>{money(t.amount, c)}</td>
                  <td className="row">
                    <button className="btn ghost sm" onClick={() => setEditing(t)}>Edit</button>
                    <button className="btn ghost sm" onClick={async () => { await api(`/transactions/${t.id}/duplicate`, { method: 'POST', body: {} }); load() }}>Duplicate</button>
                    <button className="btn ghost sm" onClick={async () => { if (confirm('Delete this transaction?')) { await api(`/transactions/${t.id}`, { method: 'DELETE' }); load() } }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No transactions yet. Add your first income or expense." action="+ Add Transaction" onAction={() => setCreating(true)} />}
      </div>
      {(creating || editing) && (
        <Modal title={editing ? 'Edit transaction' : 'Add transaction'} onClose={() => { setCreating(false); setEditing(null) }}>
          <TxForm {...lookups} initial={editing} onSave={save} onCancel={() => { setCreating(false); setEditing(null) }} />
        </Modal>
      )}
    </>
  )
}
