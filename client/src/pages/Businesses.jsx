import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, BIZ_TYPES, initials } from '../api.js'
import { Empty, Field, Modal } from '../components.jsx'

export default function Businesses({ user }) {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const c = user.currency

  async function load() { setRows(await api('/businesses')) }
  useEffect(() => { load() }, [])

  async function save(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      const fd = new FormData()
      ;['name', 'description', 'type', 'brandColor', 'currency', 'status', 'notes'].forEach(k => {
        if (form[k] != null) fd.append(k, form[k])
      })
      if (form.file) fd.append('logo', form.file)
      if (form.id) await api(`/businesses/${form.id}`, { method: 'PUT', form: fd })
      else await api('/businesses', { method: 'POST', form: fd })
      setForm(null); load()
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Businesses</h2><p className="sub">Unlimited ventures. Owner draws are not expenses. Owner contributions are not revenue.</p></div>
        <button className="btn" onClick={() => setForm({ name: '', type: 'services', brandColor: '#7A5AF8', currency: user.currency, status: 'active', description: '', notes: '' })}>+ Add Business</button>
      </div>
      {rows.length ? (
        <div className="grid cards-3">
          {rows.map(b => (
            <Link key={b.id} to={`/businesses/${b.id}`} className="card">
              <div className="row">
                <div className="avatar" style={{ background: b.brand_color }}>{b.logo ? <img src={b.logo} alt="" /> : initials(b.name)}</div>
                <div>
                  <strong>{b.name}</strong>
                  <div className="sub">{b.type} · {b.status}</div>
                </div>
              </div>
              <p className="sub">Revenue {money(b.revenue, c)}</p>
              <p className="sub">Expenses {money(b.expenses, c)}</p>
              <p>Profit <span className={b.profit >= 0 ? 'pos' : 'neg'}>{money(b.profit, c)}</span></p>
            </Link>
          ))}
        </div>
      ) : <Empty title="No businesses yet. Add your first business." action="+ Add Business" onAction={() => setForm({ name: '', type: 'services', brandColor: '#7A5AF8', currency: user.currency, status: 'active' })} />}
      {form && (
        <Modal title={form.id ? 'Edit business' : 'Add business'} onClose={() => setForm(null)}>
          <form className="form" onSubmit={save}>
            <Field label="Name"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{BIZ_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Description"><textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Brand color"><input type="color" value={form.brandColor || form.brand_color || '#7A5AF8'} onChange={e => setForm({ ...form, brandColor: e.target.value })} /></Field>
            <Field label="Currency"><input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></Field>
            <Field label="Logo (PNG, JPG, WebP, SVG)"><input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" onChange={e => setForm({ ...form, file: e.target.files[0] })} /></Field>
            <Field label="Notes"><textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Status"><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option>active</option><option>archived</option></select></Field>
            {err && <div className="err">{err}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        </Modal>
      )}
    </>
  )
}
