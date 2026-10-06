import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, Link } from 'react-router-dom'
import { api, getToken, setToken, COUNTRIES, CURRENCIES } from './api.js'
import Layout from './Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Transactions from './pages/Transactions.jsx'
import Accounts from './pages/Accounts.jsx'
import Budget from './pages/Budget.jsx'
import Debts from './pages/Debts.jsx'
import Goals from './pages/Goals.jsx'
import Businesses from './pages/Businesses.jsx'
import BusinessDetail from './pages/BusinessDetail.jsx'
import Reports from './pages/Reports.jsx'
import Coach from './pages/Coach.jsx'
import CalendarPage from './pages/Calendar.jsx'
import Settings from './pages/Settings.jsx'
import { Field } from './components.jsx'

function AuthShell({ title, children, footer }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <p style={{ color: 'var(--muted)', margin: '0 0 6px', fontWeight: 600 }}>Finance OS</p>
        <h1>{title}</h1>
        <p className="sub">Your money. Your businesses. One system.</p>
        {children}
        {footer}
      </div>
    </div>
  )
}

function Login({ onAuth }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  async function submit(e) {
    e.preventDefault()
    setErr('')
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } })
      setToken(r.token); onAuth(r.user)
    } catch (e) { setErr(e.message) }
  }
  return (
    <AuthShell title="Sign in" footer={<p className="sub">No account? <Link to="/signup">Create one</Link> · <Link to="/forgot">Reset password</Link></p>}>
      <form className="form" onSubmit={submit}>
        {err && <div className="err">{err}</div>}
        <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        <button className="btn">Sign in</button>
      </form>
    </AuthShell>
  )
}

function Signup({ onAuth }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', password: '', country: 'MZ', currency: 'MZN' })
  const [err, setErr] = useState('')
  async function submit(e) {
    e.preventDefault()
    setErr('')
    try {
      const r = await api('/auth/register', { method: 'POST', body: f })
      setToken(r.token); onAuth(r.user)
    } catch (e) { setErr(e.message) }
  }
  return (
    <AuthShell title="Create your Finance OS" footer={<p className="sub">Already have an account? <Link to="/login">Sign in</Link></p>}>
      <form className="form" onSubmit={submit}>
        {err && <div className="err">{err}</div>}
        <Field label="First name"><input value={f.firstName} onChange={e => setF({ ...f, firstName: e.target.value })} required /></Field>
        <Field label="Last name"><input value={f.lastName} onChange={e => setF({ ...f, lastName: e.target.value })} required /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Password"><input type="password" minLength={8} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required /></Field>
        <Field label="Country">
          <select value={f.country} onChange={e => setF({ ...f, country: e.target.value })}>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Currency">
          <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
        </Field>
        <button className="btn">Create account</button>
      </form>
    </AuthShell>
  )
}

function Forgot() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [token, setTok] = useState('')
  async function submit(e) {
    e.preventDefault()
    const r = await api('/auth/forgot', { method: 'POST', body: { email } })
    setMsg('If that email exists, a reset token was created.')
    if (r.resetToken) setTok(r.resetToken)
  }
  return (
    <AuthShell title="Reset password" footer={<p className="sub"><Link to="/login">Back to sign in</Link></p>}>
      <form className="form" onSubmit={submit}>
        <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
        <button className="btn">Send reset</button>
        {msg && <p className="sub">{msg}</p>}
        {token && <p className="sub">Dev token: {token}. Use it on the <Link to={`/reset?token=${token}`}>reset page</Link>.</p>}
      </form>
    </AuthShell>
  )
}

function Reset({ onAuth }) {
  const params = new URLSearchParams(window.location.search)
  const [token, setTok] = useState(params.get('token') || '')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  async function submit(e) {
    e.preventDefault()
    try {
      const r = await api('/auth/reset', { method: 'POST', body: { token, password } })
      setToken(r.token); onAuth(r.user)
    } catch (e) { setErr(e.message) }
  }
  return (
    <AuthShell title="Set a new password">
      <form className="form" onSubmit={submit}>
        {err && <div className="err">{err}</div>}
        <Field label="Token"><input value={token} onChange={e => setTok(e.target.value)} required /></Field>
        <Field label="New password"><input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></Field>
        <button className="btn">Update password</button>
      </form>
    </AuthShell>
  )
}

function Onboarding({ user, setUser }) {
  const [step, setStep] = useState(user.onboardingStep || 1)
  const [form, setForm] = useState({ firstName: user.firstName, lastName: user.lastName, currency: user.currency, country: user.country })
  const [acc, setAcc] = useState({ name: '', type: 'bank', initialBalance: '' })
  const [biz, setBiz] = useState({ name: '', type: 'services' })
  const [debt, setDebt] = useState({ creditor: '', originalAmount: '' })
  const [goal, setGoal] = useState({ name: '', targetAmount: '' })
  const [err, setErr] = useState('')

  async function next(completed) {
    const u = await api('/onboarding', { method: 'PUT', body: { step: Math.min(5, step + 1), completed, ...form } })
    setUser(u)
    if (completed) return
    setStep(s => s + 1)
  }
  async function skip() { await next(step >= 5) }

  return (
    <div className="auth">
      <div className="auth-card">
        <p style={{ color: 'var(--muted)', margin: 0 }}>Welcome to {user.firstName}'s Finance OS</p>
        <h1>Set up in five optional steps</h1>
        <p className="sub">Step {Math.min(step, 5)} of 5. Skip anything you do not have yet. No sample data is created.</p>
        {err && <div className="err">{err}</div>}
        {step === 1 && (
          <form className="form" onSubmit={async e => { e.preventDefault(); await next() }}>
            <Field label="First name"><input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} required /></Field>
            <Field label="Last name"><input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} required /></Field>
            <Field label="Currency"><select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
            <button className="btn">Continue</button>
          </form>
        )}
        {step === 2 && (
          <form className="form" onSubmit={async e => {
            e.preventDefault(); setErr('')
            try {
              if (acc.name) await api('/accounts', { method: 'POST', body: acc })
              await next()
            } catch (e) { setErr(e.message) }
          }}>
            <Field label="Account name"><input value={acc.name} onChange={e => setAcc({ ...acc, name: e.target.value })} placeholder="M-Pesa, BCI, Cash..." /></Field>
            <Field label="Type">
              <select value={acc.type} onChange={e => setAcc({ ...acc, type: e.target.value })}>
                <option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option>
                <option value="savings">Savings</option><option value="credit_card">Credit Card</option>
                <option value="digital_wallet">Digital Wallet</option><option value="investment">Investment</option><option value="other">Other</option>
              </select>
            </Field>
            <Field label="Initial balance"><input type="number" step="0.01" value={acc.initialBalance} onChange={e => setAcc({ ...acc, initialBalance: e.target.value })} /></Field>
            <div className="row"><button className="btn">Add & continue</button><button type="button" className="btn secondary" onClick={skip}>Skip</button></div>
          </form>
        )}
        {step === 3 && (
          <form className="form" onSubmit={async e => {
            e.preventDefault()
            if (biz.name) {
              const fd = new FormData(); fd.append('name', biz.name); fd.append('type', biz.type)
              await api('/businesses', { method: 'POST', form: fd })
            }
            await next()
          }}>
            <Field label="Business name"><input value={biz.name} onChange={e => setBiz({ ...biz, name: e.target.value })} /></Field>
            <Field label="Type">
              <select value={biz.type} onChange={e => setBiz({ ...biz, type: e.target.value })}>
                <option value="education">Education</option><option value="ecommerce">E-commerce</option>
                <option value="agency">Agency</option><option value="retail">Retail</option>
                <option value="services">Services</option><option value="technology">Technology</option>
                <option value="consulting">Consulting</option><option value="other">Other</option>
              </select>
            </Field>
            <div className="row"><button className="btn">Add & continue</button><button type="button" className="btn secondary" onClick={skip}>Skip</button></div>
          </form>
        )}
        {step === 4 && (
          <form className="form" onSubmit={async e => {
            e.preventDefault()
            if (debt.creditor && debt.originalAmount) await api('/debts', { method: 'POST', body: debt })
            await next()
          }}>
            <Field label="Creditor"><input value={debt.creditor} onChange={e => setDebt({ ...debt, creditor: e.target.value })} /></Field>
            <Field label="Original amount"><input type="number" step="0.01" value={debt.originalAmount} onChange={e => setDebt({ ...debt, originalAmount: e.target.value })} /></Field>
            <div className="row"><button className="btn">Add & continue</button><button type="button" className="btn secondary" onClick={skip}>Skip</button></div>
          </form>
        )}
        {step >= 5 && (
          <form className="form" onSubmit={async e => {
            e.preventDefault()
            if (goal.name && goal.targetAmount) await api('/goals', { method: 'POST', body: goal })
            await next(true)
          }}>
            <Field label="Goal name"><input value={goal.name} onChange={e => setGoal({ ...goal, name: e.target.value })} /></Field>
            <Field label="Target amount"><input type="number" step="0.01" value={goal.targetAmount} onChange={e => setGoal({ ...goal, targetAmount: e.target.value })} /></Field>
            <div className="row"><button className="btn">Finish</button><button type="button" className="btn secondary" onClick={() => next(true)}>Skip & enter</button></div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())
  const nav = useNavigate()

  useEffect(() => {
    const theme = localStorage.getItem('fos-theme') || user?.theme || 'light'
    document.documentElement.setAttribute('data-theme', theme)
  }, [user])

  useEffect(() => {
    if (!getToken()) return setLoading(false)
    api('/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="auth"><p>Loading Finance OS…</p></div>

  function authed(u) {
    setUser(u)
    nav('/')
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login onAuth={authed} />} />
      <Route path="/signup" element={user ? <Navigate to="/" /> : <Signup onAuth={authed} />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset onAuth={authed} />} />
      {!user && <Route path="*" element={<Navigate to="/login" />} />}
      {user && !user.onboardingCompleted && <Route path="*" element={<Onboarding user={user} setUser={setUser} />} />}
      {user && user.onboardingCompleted && (
        <Route element={<Layout user={user} setUser={setUser} />}>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/transactions" element={<Transactions user={user} />} />
          <Route path="/accounts" element={<Accounts user={user} />} />
          <Route path="/budget" element={<Budget user={user} />} />
          <Route path="/debts" element={<Debts user={user} />} />
          <Route path="/goals" element={<Goals user={user} />} />
          <Route path="/businesses" element={<Businesses user={user} />} />
          <Route path="/businesses/:id" element={<BusinessDetail user={user} />} />
          <Route path="/reports" element={<Reports user={user} />} />
          <Route path="/coach" element={<Coach user={user} />} />
          <Route path="/calendar" element={<CalendarPage user={user} />} />
          <Route path="/settings" element={<Settings user={user} setUser={setUser} />} />
        </Route>
      )}
    </Routes>
  )
}
