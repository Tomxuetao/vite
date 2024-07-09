import { performance } from 'node:perf_hooks'
import { createDebugger, prettifyUrl, timeFrom } from '../../utils'
const logTime = createDebugger('vite:time')
export function timeMiddleware(root) {
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return function viteTimeMiddleware(req, res, next) {
    const start = performance.now()
    const end = res.end
    res.end = (...args) => {
      logTime?.(`${timeFrom(start)} ${prettifyUrl(req.url, root)}`)
      return end.call(res, ...args)
    }
    next()
  }
}
