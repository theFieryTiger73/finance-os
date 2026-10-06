import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, ArrowLeftRight, Wallet, PieChart, Landmark, Target, Store,
  BarChart3, MessageSquare, CalendarDays, Settings, Plus, Search, Menu, LogOut
} from 'lucide-react'
import { api, setToken } from './api.js'
import { Modal, TxForm, useLookups } from './components.jsx'

const NAV = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/transactions', 'Transactions', ArrowLeftRight],
  ['/accounts', 'Accounts', Wallet],
  ['/budget', 'Budget', PieChart],
  ['/debts', 'Debts', Landmark],
  ['/goals', 'Goals', Target],
  ['/businesses', 'Businesses', Store],
  ['/reports', 'Reports', BarChart3],
  ['/coach', 'Financial Coach', MessageSquare],
  ['/calendar', 'Calendar', CalendarDays],
  ['/settings', 'Settings', Settings]
]

export default function Layout({ user, setUser }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [txOpen, setTxOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [preset, setPreset] = useState(null)
  const nav = useNavigate()
  const loc = useLocation()
  const lookups = useLookups()

  useEffect(() => { setOpen(false); setResults(null); setQ('') }, [loc.pathname])

  async function search(v) {
    setQ(v)
    if (!v.trim()) return setResults(null)
    setResults(await api(`/search?q=${encodeURIComponent(v)}`))
  }

  function logout() {
    setToken(null)
    setUser(null)
    nav('/login')
  }

  async function saveTx(form) {
    await api('/transactions', { method: 'POST', form })
    setTxOpen(false)
    setPreset(null)
    window.dispatchEvent(new Event('fos-refresh'))
  }

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <h1>{user.brandName}</h1>
          <p>Your money. Your businesses. One system.</p>
        </div>
        <nav className="nav">
          {NAV.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="btn" style={{ width: '100%' }} onClick={() => { setPreset(null); setTxOpen(true) }}>+ Add Transaction</button>
          <button className="linkish" style={{ marginTop: 8, background: 'none', border: 0, color: '#98a2b3' }} onClick={logout}><LogOut size={14} /> Logout</button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <button className="btn ghost sm menu" onClick={() => setOpen(o => !o)}><Menu size={18} /></button>
          <div className="search">
            <Search size={16} />
            <input placeholder="Search transactions, accounts, businesses, debts, goals..." value={q} onChange={e => search(e.target.value)} />
          </div>
          <button className="btn sm" onClick={() => { setPreset(null); setTxOpen(true) }}>+ Transaction</button>
        </header>
        {results && (
          <div className="search-panel">
            {['transactions', 'accounts', 'businesses', 'debts', 'goals', 'categories'].map(k => (
              results[k]?.length ? (
                <div key={k} style={{ padding: 12 }}>
                  <strong style={{ textTransform: 'capitalize', fontSize: 12, color: 'var(--muted)' }}>{k}</strong>
                  {results[k].map(r => (
                    <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                      {r.name || r.creditor || r.description || r.type}
                    </div>
                  ))}
                </div>
              ) : null
            ))}
            {!Object.values(results).some(x => x.length) && <div className="empty">No matches.</div>}
          </div>
        )}
        <main className="page"><Outlet /></main>
        <nav className="mobile-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/transactions">Tx</NavLink>
          <NavLink to="/accounts">Accounts</NavLink>
          <NavLink to="/goals">Goals</NavLink>
          <NavLink to="/settings">More</NavLink>
        </nav>
      </div>
      <button className="fab" onClick={() => setFabOpen(f => !f)}>+</button>
      {fabOpen && (
        <div style={{ position: 'fixed', right: 18, bottom: 148, zIndex: 31, display: 'grid', gap: 8 }}>
          {[['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer']].map(([t, l]) => (
            <button key={t} className="btn sm" onClick={() => { setPreset({ type: t }); setTxOpen(true); setFabOpen(false) }}>{l}</button>
          ))}
        </div>
      )}
      {txOpen && (
        <Modal title="Add Transaction" onClose={() => { setTxOpen(false); setPreset(null) }}>
          <TxForm {...lookups} initial={preset} onSave={saveTx} onCancel={() => { setTxOpen(false); setPreset(null) }} />
        </Modal>
      )}
    </div>
  )
}
