import { useEffect, useState } from 'react'
import { api, money, TX_TYPES, today } from './api.js'

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={wide ? { width: 'min(720px, 100%)' } : undefined} onClick={e => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: 'var(--text)', fontSize: 18 }}>{title}</h3>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ title, action, onAction }) {
  return (
    <div className="empty">
      <p>{title}</p>
      {action && <button className="btn sm" onClick={onAction}>{action}</button>}
    </div>
  )
}

export function Progress({ pct, kind = 'ok' }) {
  return <div className={`progress ${kind}`}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
}

export function Money({ value, currency, signed }) {
  const n = Number(value) || 0
  const cls = signed ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : ''
  return <span className={cls}>{money(n, currency)}</span>
}

export function Field({ label, children }) {
  return <label>{label}{children}</label>
}

export function TxForm({ accounts, categories, businesses, debts, goals, initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    type: initial?.type || 'expense',
    amount: initial?.amount || '',
    date: initial?.date || today(),
    accountId: initial?.account_id || initial?.accountId || accounts[0]?.id || '',
    toAccountId: initial?.to_account_id || '',
    categoryId: initial?.category_id || '',
    businessId: initial?.business_id || '',
    debtId: initial?.debt_id || initial?.debtId || '',
    goalId: initial?.goal_id || '',
    description: initial?.description || '',
    notes: initial?.notes || '',
    tags: initial?.tags || '',
    file: null
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const catType = form.type === 'income' || form.type === 'owner_contribution' ? 'income' : 'expense'
  const cats = categories.filter(c => c.status !== 'archived' && (form.type === 'transfer' || c.type === catType || form.type === 'adjustment' || form.type === 'investment' || form.type === 'refund'))

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setErr('')
    setBusy(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'file') return
        if (v !== '' && v != null) fd.append(k, v)
      })
      if (form.file) fd.append('attachment', form.file)
      await onSave(fd)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        {TX_TYPES.map(([v, l]) => (
          <button type="button" key={v} className={`chip ${form.type === v ? 'active' : ''}`} onClick={() => set('type', v)}>{l}</button>
        ))}
      </div>
      <Field label="Amount"><input type="number" step="0.01" min="0" required value={form.amount} onChange={e => set('amount', e.target.value)} /></Field>
      <Field label="Date"><input type="date" required value={form.date} onChange={e => set('date', e.target.value)} /></Field>
      <Field label={form.type === 'transfer' ? 'From account' : 'Account'}>
        <select value={form.accountId} onChange={e => set('accountId', e.target.value)} required={form.type !== 'adjustment'}>
          <option value="">Select account</option>
          {accounts.filter(a => a.status !== 'archived').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      {form.type === 'transfer' || form.type === 'investment' ? (
        <Field label="To account">
          <select value={form.toAccountId} onChange={e => set('toAccountId', e.target.value)}>
            <option value="">Select account</option>
            {accounts.filter(a => a.status !== 'archived').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      ) : null}
      {form.type !== 'transfer' && (
        <Field label="Category">
          <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Business (optional)">
        <select value={form.businessId} onChange={e => set('businessId', e.target.value)}>
          <option value="">Personal</option>
          {businesses.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      {form.type === 'debt_payment' && (
        <Field label="Debt">
          <select value={form.debtId} onChange={e => set('debtId', e.target.value)} required>
            <option value="">Select debt</option>
            {debts.filter(d => d.status === 'active' || d.status === 'overdue').map(d => <option key={d.id} value={d.id}>{d.creditor}</option>)}
          </select>
        </Field>
      )}
      {(form.type === 'income' || form.type === 'transfer') && goals?.length > 0 && (
        <Field label="Apply toward goal">
          <select value={form.goalId} onChange={e => set('goalId', e.target.value)}>
            <option value="">None</option>
            {goals.filter(g => g.status === 'active').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Description"><input value={form.description} onChange={e => set('description', e.target.value)} /></Field>
      <Field label="Notes"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      <Field label="Tags"><input value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="comma,separated" /></Field>
      <Field label="Receipt / invoice"><input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,.pdf,image/*,application/pdf" onChange={e => set('file', e.target.files[0])} /></Field>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

const FREQ = [['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]

export function RecurringForm({ accounts = [], categories = [], businesses = [], debts = [], initial, onSave, onCancel, lockBusiness }) {
  const [form, setForm] = useState({
    type: initial?.type || 'expense',
    amount: initial?.amount || '',
    frequency: initial?.frequency || 'monthly',
    startDate: initial?.startDate || initial?.start_date || today(),
    endDate: initial?.endDate || initial?.end_date || '',
    accountId: initial?.accountId || initial?.account_id || accounts.filter(a => a.status !== 'archived')[0]?.id || '',
    toAccountId: initial?.toAccountId || initial?.to_account_id || '',
    categoryId: initial?.categoryId || initial?.category_id || '',
    businessId: lockBusiness || initial?.businessId || initial?.business_id || '',
    debtId: initial?.debtId || initial?.debt_id || '',
    description: initial?.description || '',
    status: initial?.status || 'active'
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const cats = categories.filter(c => c.status !== 'archived' && (form.type === 'expense' ? c.type === 'expense' : form.type === 'income' ? c.type === 'income' : true))

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setErr(''); setBusy(true)
    try {
      const body = { ...form, businessId: lockBusiness || form.businessId || null }
      await onSave(body)
    } catch (ex) { setErr(ex.message) }
    finally { setBusy(false) }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        {[['expense', 'Expense'], ['income', 'Income'], ['debt_payment', 'Debt payment']].map(([v, l]) => (
          <button type="button" key={v} className={`chip ${form.type === v ? 'active' : ''}`} onClick={() => set('type', v)}>{l}</button>
        ))}
      </div>
      <Field label="Description"><input required value={form.description} onChange={e => set('description', e.target.value)} placeholder={form.type === 'expense' ? 'Rent, internet, salary…' : 'Description'} /></Field>
      <Field label="Amount"><input type="number" step="0.01" min="0" required value={form.amount} onChange={e => set('amount', e.target.value)} /></Field>
      <Field label="Frequency"><select value={form.frequency} onChange={e => set('frequency', e.target.value)}>{FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Start date"><input type="date" required value={form.startDate} onChange={e => set('startDate', e.target.value)} /></Field>
      <Field label="End date (optional)"><input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} /></Field>
      <Field label="Account">
        <select value={form.accountId} onChange={e => set('accountId', e.target.value)} required>
          <option value="">Select account</option>
          {accounts.filter(a => a.status !== 'archived').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      {form.type !== 'transfer' && (
        <Field label="Category">
          <select value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {lockBusiness == null && (
        <Field label="Scope">
          <select value={form.businessId || ''} onChange={e => set('businessId', e.target.value)}>
            <option value="">Personal</option>
            {businesses.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      )}
      {form.type === 'debt_payment' && (
        <Field label="Debt">
          <select value={form.debtId} onChange={e => set('debtId', e.target.value)} required>
            <option value="">Select debt</option>
            {debts.filter(d => d.status === 'active' || d.status === 'overdue').map(d => <option key={d.id} value={d.id}>{d.creditor}</option>)}
          </select>
        </Field>
      )}
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save recurring'}</button>
        <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

export function RecurringList({ rows, currency, businesses, onConfirm, onPause, onResume, onAdd }) {
  const bizName = id => businesses?.find(b => Number(b.id) === Number(id))?.name
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Recurring expenses</h3>
        {onAdd && <button className="btn sm" onClick={onAdd}>+ Recurring</button>}
      </div>
      <p className="sub">Stays expected until you confirm. Confirm posts the transaction and moves the next date.</p>
      {rows.length ? rows.map(r => (
        <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', opacity: r.status === 'paused' ? 0.55 : 1 }}>
          <div>
            <div>{r.description || r.type} · {r.frequency}{r.business_id ? ` · ${bizName(r.business_id) || 'business'}` : ' · personal'}</div>
            <div className="sub">Next {r.next_date} · {money(r.amount, currency)}{r.status === 'paused' ? ' · paused' : ''}</div>
          </div>
          <div className="row">
            {r.status === 'active' && onConfirm && <button className="btn sm" onClick={() => onConfirm(r)}>Confirm</button>}
            {r.status === 'active' && onPause && <button className="btn sm ghost" onClick={() => onPause(r)}>Pause</button>}
            {r.status === 'paused' && onResume && <button className="btn sm secondary" onClick={() => onResume(r)}>Resume</button>}
          </div>
        </div>
      )) : <Empty title="No recurring expenses yet." action={onAdd ? '+ Recurring' : undefined} onAction={onAdd} />}
    </div>
  )
}

export function useLookups() {
  const [data, setData] = useState({ accounts: [], categories: [], businesses: [], debts: [], goals: [] })
  useEffect(() => {
    function load() {
      Promise.all([
        api('/accounts'), api('/categories'), api('/businesses'), api('/debts'), api('/goals')
      ]).then(([accounts, categories, businesses, debts, goals]) => setData({ accounts, categories, businesses, debts, goals })).catch(() => {})
    }
    load()
    window.addEventListener('fos-refresh', load)
    return () => window.removeEventListener('fos-refresh', load)
  }, [])
  return data
}
