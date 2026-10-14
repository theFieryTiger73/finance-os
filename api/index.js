import { createApp } from '../server/index.js'
import { applyOriginalApiPath } from '../server/vercel-path.js'

let appPromise

export default async function handler(req, res) {
  if (!appPromise) appPromise = createApp()
  const app = await appPromise
  applyOriginalApiPath(req)
  return app(req, res)
}
