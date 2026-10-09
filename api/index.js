import { createApp } from '../server/index.js'

let appPromise

export default async function handler(req, res) {
  if (!appPromise) appPromise = createApp()
  const app = await appPromise
  if (req.url && !req.url.startsWith('/api')) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    const p = q ? req.url.slice(0, req.url.indexOf('?')) : req.url
    req.url = '/api' + (p.startsWith('/') ? p : '/' + p) + q
  }
  return app(req, res)
}
