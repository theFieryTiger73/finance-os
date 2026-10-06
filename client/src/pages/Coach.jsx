import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Empty, Progress } from '../components.jsx'

export default function Coach() {
  const [data, setData] = useState(null)
  useEffect(() => { api('/coach').then(setData) }, [])
  if (!data) return <p className="sub">Analyzing your data…</p>
  return (
    <>
      <h2>Financial Coach</h2>
      <p className="sub">Recommendations are generated from your recorded data only.</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Next action</h3>
        <strong>{data.nextAction.title}</strong>
        <p className="sub">{data.nextAction.body}</p>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Finance OS indicator {data.health.score}/100</h3>
        {data.health.breakdown.map(b => (
          <div key={b.key} style={{ marginBottom: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span>{b.label}</span><span>{b.points}/{b.max}</span></div>
            <Progress pct={(b.points / b.max) * 100} />
          </div>
        ))}
      </div>
      {data.insights.length ? data.insights.map((i, n) => (
        <div key={n} className="card" style={{ marginBottom: 10 }}>
          <span className={`pill ${i.type === 'positive' ? 'ok' : i.type === 'critical' ? 'bad' : i.type === 'warning' ? 'warn' : 'info'}`}>{i.type}</span>
          <p>{i.text}</p>
        </div>
      )) : <Empty title="No insights yet. Record transactions so the coach can analyze real activity." />}
    </>
  )
}
