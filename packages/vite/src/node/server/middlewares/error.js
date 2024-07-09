import colors from 'picocolors'
import strip from 'strip-ansi'
import { pad } from '../../utils'
export function prepareError(err) {
  // only copy the information we need and avoid serializing unnecessary
  // properties, since some errors may attach full objects (e.g. PostCSS)
  return {
    message: strip(err.message),
    stack: strip(cleanStack(err.stack || '')),
    id: err.id,
    frame: strip(err.frame || ''),
    plugin: err.plugin,
    pluginCode: err.pluginCode?.toString(),
    loc: err.loc,
  }
}
export function buildErrorMessage(err, args = [], includeStack = true) {
  if (err.plugin) args.push(`  Plugin: ${colors.magenta(err.plugin)}`)
  const loc = err.loc ? `:${err.loc.line}:${err.loc.column}` : ''
  if (err.id) args.push(`  File: ${colors.cyan(err.id)}${loc}`)
  if (err.frame) args.push(colors.yellow(pad(err.frame)))
  if (includeStack && err.stack) args.push(pad(cleanStack(err.stack)))
  return args.join('\n')
}
function cleanStack(stack) {
  return stack
    .split(/\n/g)
    .filter((l) => /^\s*at/.test(l))
    .join('\n')
}
export function logError(server, err) {
  const msg = buildErrorMessage(err, [
    colors.red(`Internal server error: ${err.message}`),
  ])
  server.config.logger.error(msg, {
    clear: true,
    timestamp: true,
    error: err,
  })
  server.hot.send({
    type: 'error',
    err: prepareError(err),
  })
}
export function errorMiddleware(server, allowNext = false) {
  // note the 4 args must be kept for connect to treat this as error middleware
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return function viteErrorMiddleware(err, _req, res, next) {
    logError(server, err)
    if (allowNext) {
      next()
    } else {
      res.statusCode = 500
      res.end(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <title>Error</title>
            <script type="module">
              import { ErrorOverlay } from '/@vite/client'
              document.body.appendChild(new ErrorOverlay(${JSON.stringify(prepareError(err)).replace(/</g, '\\u003c')}))
            </script>
          </head>
          <body>
          </body>
        </html>
      `)
    }
  }
}
