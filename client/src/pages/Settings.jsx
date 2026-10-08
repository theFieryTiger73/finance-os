import { useEffect, useState } from 'react'
import { api, setToken, COUNTRIES, CURRENCIES } from '../api.js'
import { Empty, Field, Modal } from '../components.jsx'
import { isOnline, queueAll, cacheClear } from '../offline.js'
import { flushQueue } from '../sync.js'

export default function Settings({ user, setUser }) {
  const [profile, setProfile] = useState({ ...user })
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' })
  const [msg, setMsg] = useState('')
  const [cats, setCats] = useState([])
  const [rules, setRules] = useState([])
  const [catForm, setCatForm] = useState(null)
  const [ruleForm, setRuleForm] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [backups, setBackups] = useState({ backups: [], integrity: 'ok' })
  const [auditRows, setAuditRows] = useState([])
  const [syncState, setSyncState] = useState({ online: isOnline(), pending: 0, failed: [] })

  async function load() {
    setCats(await api('/categories'))
    setRules(await api('/allocations'))
    setAccounts(await api('/accounts'))
    try {
      setBackups(await api('/data/backups'))
      setAuditRows(await api('/audit'))
    } catch { /* optional */ }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    async function refresh() {
      const rows = await queueAll().catch(() => [])
      setSyncState({
        online: isOnline(),
        pending: rows.filter(r => r.status !== 'failed').length,
        failed: rows.filter(r => r.status === 'failed')
      })
    }
    refresh()
    window.addEventListener('fos-offline', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      window.removeEventListener('fos-offline', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [])

  async function saveProfile(e) {
    e.preventDefault()
    const u = await api('/me', { method: 'PUT', body: profile })
    setUser(u)
    localStorage.setItem('fos-theme', u.theme)
    document.documentElement.setAttribute('data-theme', u.theme)
    setMsg('Profile saved.')
  }

  function toggleTheme() {
    const theme = (profile.theme || 'light') === 'light' ? 'dark' : 'light'
    setProfile({ ...profile, theme })
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fos-theme', theme)
  }

  return (
    <>
      <h2>Settings</h2>
      <p className="sub">Profile, appearance, currency, categories, allocations and security.</p>
      {msg && <p className="pill ok">{msg}</p>}
      <div className="grid cards-2">
        <form className="card form" onSubmit={saveProfile}>
          <h3>Profile</h3>
          <Field label="First name"><input value={profile.firstName} onChange={e => setProfile({ ...profile, firstName: e.target.value })} /></Field>
          <Field label="Last name"><input value={profile.lastName} onChange={e => setProfile({ ...profile, lastName: e.target.value })} /></Field>
          <Field label="Country"><select value={profile.country} onChange={e => setProfile({ ...profile, country: e.target.value })}>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Currency"><select value={profile.currency} onChange={e => setProfile({ ...profile, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Language"><select value={profile.language} onChange={e => setProfile({ ...profile, language: e.target.value })}><option value="en">English</option><option value="pt">Português</option></select></Field>
          <Field label="Emergency fund target"><input type="number" step="0.01" value={profile.emergencyFundTarget} onChange={e => setProfile({ ...profile, emergencyFundTarget: e.target.value })} /></Field>
          <Field label="Minimum liquidity"><input type="number" step="0.01" value={profile.minLiquidity} onChange={e => setProfile({ ...profile, minLiquidity: e.target.value })} /></Field>
          <div className="row">
            <button className="btn">Save profile</button>
            <button type="button" className="btn secondary" onClick={toggleTheme}>{profile.theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          </div>
        </form>
        <form className="card form" onSubmit={async e => {
          e.preventDefault()
          await api('/me/password', { method: 'PUT', body: pw })
          setMsg('Password updated.'); setPw({ currentPassword: '', newPassword: '' })
        }}>
          <h3>Security</h3>
          <Field label="Current password"><input type="password" value={pw.currentPassword} onChange={e => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password"><input type="password" minLength={8} value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <button className="btn">Update password</button>
          <button type="button" className="btn ghost" onClick={() => { setToken(null); setUser(null); cacheClear().catch(() => {}) }}>Log out</button>
        </form>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Categories</h3>
          <button className="btn sm" onClick={() => setCatForm({ name: '', type: 'expense', scope: 'personal', icon: 'tag', color: '#2E90FA' })}>+ Category</button>
        </div>
        {cats.filter(c => c.status !== 'archived').map(c => (
          <div key={c.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
            <span>{c.name} · {c.type} · {c.scope}</span>
            <span>
              <button className="btn ghost sm" onClick={() => setCatForm({ ...c, parentId: c.parent_id, businessId: c.business_id })}>Edit</button>
              <button className="btn ghost sm" onClick={async () => { await api(`/categories/${c.id}/archive`, { method: 'POST' }); load() }}>Archive</button>
            </span>
          </div>
        ))}
        {!cats.length && <Empty title="No categories yet." />}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Money allocation rules</h3>
          <button className="btn sm" onClick={() => setRuleForm({ name: '', triggerType: 'income', source: '', splits: [
            { label: 'Operating', percent: 30 }, { label: 'Personal', percent: 30 }, { label: 'Debt', percent: 20 }, { label: 'Emergency', percent: 10 }, { label: 'Growth', percent: 10 }
          ] })}>+ Rule</button>
        </div>
        <p className="sub">Optional. Never forced. Example: 5,000 received can split across operating, personal, debt, emergency and growth.</p>
        {rules.map(r => (
          <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0' }}>
            <div>
              <strong>{r.name}</strong>
              <div className="sub">{r.trigger_type} {r.source} · {r.splits.map(s => `${s.label} ${s.percent}%`).join(' / ')}</div>
            </div>
            <button className="btn ghost sm" onClick={() => setRuleForm({ ...r, triggerType: r.trigger_type, splits: r.splits })}>Edit</button>
          </div>
        ))}
        {!rules.length && <Empty title="No allocation rules yet. Create one only if you want income splitting." />}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Offline sync</h3>
        <p className="sub">{syncState.online ? 'Online' : 'Offline'}. {syncState.pending} change{syncState.pending === 1 ? '' : 's'} waiting to sync. Add transactions on your phone without signal; they upload when you reconnect.</p>
        <div className="row">
          <button className="btn sm" disabled={!syncState.online || !syncState.pending} onClick={async () => { await flushQueue(); setMsg('Sync attempted.') }}>Sync now</button>
        </div>
        {syncState.failed.length ? (
          <div style={{ marginTop: 10 }}>
            {syncState.failed.map(f => (
              <div key={f.id} className="sub">{f.method} {f.path} · {f.lastError || 'failed'}</div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h3>Your data</h3>
        <p className="sub">Transactions are never erased. Voiding keeps a restoreable history. Daily snapshots are stored on this server. Download a JSON copy for yourself.</p>
        <p className="sub">Database integrity: {backups.integrity}</p>
        <div className="row">
          <button className="btn sm" onClick={async () => {
            const data = await api('/data/export')
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `finance-os-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
            setMsg('Export downloaded.')
          }}>Download backup JSON</button>
          <button className="btn sm secondary" onClick={async () => {
            const r = await api('/data/backup', { method: 'POST', body: {} })
            setMsg(`Snapshot saved: ${r.file}`)
            setBackups(await api('/data/backups'))
          }}>Save server snapshot</button>
          <label className="btn sm secondary">
            Restore JSON
            <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async e => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                const payload = JSON.parse(await file.text())
                await api('/data/restore', { method: 'POST', body: payload })
                setMsg('Restore completed. Missing records were added; existing records were kept.')
                load()
              } catch (ex) { setMsg(ex.message) }
            }} />
          </label>
        </div>
        {backups.backups?.length ? (
          <p className="sub" style={{ marginTop: 10 }}>{backups.backups.length} server snapshot{backups.backups.length === 1 ? '' : 's'} retained (latest {backups.backups[0].createdAt}).</p>
        ) : <p className="sub">No snapshots yet. One is created automatically each day and on shutdown.</p>}
        {auditRows.length ? (
          <div style={{ marginTop: 12 }}>
            <h3>Recent activity log</h3>
            {auditRows.slice(0, 12).map(r => (
              <div key={r.id} className="sub">{r.created_at} · {r.action} {r.entity} {r.entity_id || ''}</div>
            ))}
          </div>
        ) : null}
      </div>
      {catForm && (
        <Modal title={catForm.id ? 'Edit category' : 'Add category'} onClose={() => setCatForm(null)}>
          <form className="form" onSubmit={async e => {
            e.preventDefault()
            if (catForm.id) await api(`/categories/${catForm.id}`, { method: 'PUT', body: catForm })
            else await api('/categories', { method: 'POST', body: catForm })
            setCatForm(null); load()
          }}>
            <Field label="Name"><input required value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></Field>
            <Field label="Type"><select value={catForm.type} onChange={e => setCatForm({ ...catForm, type: e.target.value })}><option>income</option><option>expense</option></select></Field>
            <Field label="Scope"><select value={catForm.scope} onChange={e => setCatForm({ ...catForm, scope: e.target.value })}><option>personal</option><option>business</option></select></Field>
            <Field label="Parent">
              <select value={catForm.parentId || ''} onChange={e => setCatForm({ ...catForm, parentId: e.target.value })}>
                <option value="">None</option>
                {cats.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Color"><input type="color" value={catForm.color} onChange={e => setCatForm({ ...catForm, color: e.target.value })} /></Field>
            <button className="btn">Save</button>
          </form>
        </Modal>
      )}
      {ruleForm && (
        <Modal title={ruleForm.id ? 'Edit rule' : 'Allocation rule'} onClose={() => setRuleForm(null)}>
          <form className="form" onSubmit={async e => {
            e.preventDefault()
            if (ruleForm.id) await api(`/allocations/${ruleForm.id}`, { method: 'PUT', body: ruleForm })
            else await api('/allocations', { method: 'POST', body: ruleForm })
            setRuleForm(null); load()
          }}>
            <Field label="Name"><input required value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} /></Field>
            <Field label="Trigger"><select value={ruleForm.triggerType} onChange={e => setRuleForm({ ...ruleForm, triggerType: e.target.value })}><option value="income">Salary / income</option><option value="business_revenue">Business revenue</option><option value="product_sales">Product sales</option></select></Field>
            <Field label="Source note"><input value={ruleForm.source || ''} onChange={e => setRuleForm({ ...ruleForm, source: e.target.value })} /></Field>
            {ruleForm.splits.map((s, i) => (
              <div className="row" key={i}>
                <input value={s.label} onChange={e => { const splits = [...ruleForm.splits]; splits[i] = { ...s, label: e.target.value }; setRuleForm({ ...ruleForm, splits }) }} />
                <input type="number" value={s.percent} onChange={e => { const splits = [...ruleForm.splits]; splits[i] = { ...s, percent: Number(e.target.value) }; setRuleForm({ ...ruleForm, splits }) }} />
                <select value={s.accountId || ''} onChange={e => { const splits = [...ruleForm.splits]; splits[i] = { ...s, accountId: e.target.value }; setRuleForm({ ...ruleForm, splits }) }}>
                  <option value="">Account</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            ))}
            <button type="button" className="btn secondary sm" onClick={() => setRuleForm({ ...ruleForm, splits: [...ruleForm.splits, { label: 'Other', percent: 0 }] })}>Add split</button>
            <button className="btn">Save rule</button>
          </form>
        </Modal>
      )}
    </>
  )
}
