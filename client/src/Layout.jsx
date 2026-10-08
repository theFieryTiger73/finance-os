import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, ArrowLeftRight, Wallet, PieChart, Landmark, Target, Store,
  BarChart3, MessageSquare, CalendarDays, Settings, Search, Menu, LogOut
} from 'lucide-react'
import { api, setToken } from './api.js'
import { Modal, TxForm, RecurringForm, useLookups } from './components.jsx'
import { isOnline, pendingCount, cacheClear } from './offline.js'
import { flushQueue } from './sync.js'

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

const SEARCH_HREF = {
  transactions: '/transactions',
  accounts: '/accounts',
  businesses: '/businesses',
  debts: '/debts',
  goals: '/goals',
  categories: '/budget'
}

export default function Layout({ user, setUser }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [txOpen, setTxOpen] = useState(false)
  const [recOpen, setRecOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const [preset, setPreset] = useState(null)
  const [notes, setNotes] = useState([])
  const [showNotes, setShowNotes] = useState(false)
  const [online, setOnline] = useState(isOnline())
  const [pending, setPending] = useState(0)
  const nav = useNavigate()
  const loc = useLocation()
  const lookups = useLookups()

  useEffect(() => { setOpen(false); setResults(null); setQ('') }, [loc.pathname])
  useEffect(() => {
    api('/notifications').then(setNotes).catch(() => {})
  }, [loc.pathname])
  useEffect(() => {
    function refresh() {
      setOnline(isOnline())
      pendingCount().then(setPending).catch(() => setPending(0))
    }
    refresh()
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    window.addEventListener('fos-offline', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      window.removeEventListener('fos-offline', refresh)
    }
  }, [])

  async function search(v) {
    setQ(v)
    if (!v.trim()) return setResults(null)
    try { setResults(await api(`/search?q=${encodeURIComponent(v)}`)) }
    catch { setResults({ transactions: [], accounts: [], businesses: [], debts: [], goals: [], categories: [] }) }
  }

  function goSearch(kind, r) {
    setResults(null); setQ('')
    if (kind === 'businesses') return nav(`/businesses/${r.id}`)
    nav(SEARCH_HREF[kind] || '/')
  }

  function logout() {
    setToken(null)
    setUser(null)
    cacheClear().catch(() => {})
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
      {open && <div className="nav-backdrop" onClick={() => setOpen(false)} />}
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
        {(!online || pending > 0) && (
          <div className={`offline-banner ${online ? 'queued' : 'offline'}`}>
            <span>{online ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync` : pending ? `Offline · ${pending} queued` : 'Offline · new entries will sync later'}</span>
            {online && pending > 0 && <button className="btn sm ghost" onClick={() => flushQueue()}>Sync now</button>}
          </div>
        )}
        <header className="topbar">
          <button className="btn ghost sm menu" onClick={() => setOpen(o => !o)}><Menu size={18} /></button>
          <div className="search">
            <Search size={16} />
            <input placeholder="Search transactions, accounts, businesses, debts, goals..." value={q} onChange={e => search(e.target.value)} />
          </div>
          <button className="btn sm ghost" onClick={() => setShowNotes(s => !s)}>
            {notes.filter(n => !n.read).length ? `${notes.filter(n => !n.read).length} alerts` : 'Alerts'}
          </button>
          <button className="btn sm" onClick={() => { setPreset(null); setTxOpen(true) }}>+ Transaction</button>
        </header>
        {showNotes && (
          <div className="search-panel">
            {notes.length ? notes.map(n => (
              <div key={n.id} style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
                <strong>{n.title}</strong>
                <div className="sub">{n.message}</div>
                {!n.read && <button className="btn ghost sm" onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'POST' }); setNotes(x => x.map(i => i.id === n.id ? { ...i, read: 1 } : i)) }}>Mark read</button>}
              </div>
            )) : <div className="empty">No alerts.</div>}
          </div>
        )}
        {results && (
          <div className="search-panel">
            {['transactions', 'accounts', 'businesses', 'debts', 'goals', 'categories'].map(k => (
              results[k]?.length ? (
                <div key={k} style={{ padding: 12 }}>
                  <strong style={{ textTransform: 'capitalize', fontSize: 12, color: 'var(--muted)' }}>{k}</strong>
                  {results[k].map(r => (
                    <button key={r.id} className="linkish" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 0', border: 0, background: 'none', borderBottom: '1px solid var(--line)', color: 'inherit' }} onClick={() => goSearch(k, r)}>
                      {r.name || r.creditor || r.description || r.type}
                    </button>
                  ))}
                </div>
              ) : null
            ))}
            {!Object.values(results).some(x => x.length) && <div className="empty">No matches.</div>}
          </div>
        )}
        <main className="page"><Outlet /></main>
        <nav className="mobile-nav">
          <NavLink to="/" end><LayoutDashboard size={18} /><span>Home</span></NavLink>
          <NavLink to="/transactions"><ArrowLeftRight size={18} /><span>Tx</span></NavLink>
          <NavLink to="/accounts"><Wallet size={18} /><span>Accounts</span></NavLink>
          <NavLink to="/goals"><Target size={18} /><span>Goals</span></NavLink>
          <NavLink to="/settings"><Settings size={18} /><span>More</span></NavLink>
        </nav>
      </div>
      <button className="fab" onClick={() => setFabOpen(f => !f)}>+</button>
      {fabOpen && (
        <div style={{ position: 'fixed', right: 18, bottom: 148, zIndex: 31, display: 'grid', gap: 8 }}>
          {[['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer']].map(([t, l]) => (
            <button key={t} className="btn sm" onClick={() => { setPreset({ type: t }); setTxOpen(true); setFabOpen(false) }}>{l}</button>
          ))}
          <button className="btn sm secondary" onClick={() => { setRecOpen(true); setFabOpen(false) }}>Recurring</button>
        </div>
      )}
      {txOpen && (
        <Modal title="Add Transaction" onClose={() => { setTxOpen(false); setPreset(null) }}>
          <TxForm {...lookups} initial={preset} onSave={saveTx} onCancel={() => { setTxOpen(false); setPreset(null) }} />
        </Modal>
      )}
      {recOpen && (
        <Modal title="Add recurring expense" onClose={() => setRecOpen(false)}>
          <RecurringForm {...lookups} initial={{ type: 'expense', frequency: 'monthly' }} onSave={async body => { await api('/recurring', { method: 'POST', body }); setRecOpen(false); window.dispatchEvent(new Event('fos-refresh')) }} onCancel={() => setRecOpen(false)} />
        </Modal>
      )}
    </div>
  )
}
