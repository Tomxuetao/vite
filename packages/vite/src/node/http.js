import fsp from 'node:fs/promises'
import path from 'node:path'
import colors from 'picocolors'
export async function resolveHttpServer({ proxy }, app, httpsOptions) {
  if (!httpsOptions) {
    const { createServer } = await import('node:http')
    return createServer(app)
  }
  // #484 fallback to http1 when proxy is needed.
  if (proxy) {
    const { createServer } = await import('node:https')
    return createServer(httpsOptions, app)
  } else {
    const { createSecureServer } = await import('node:http2')
    return createSecureServer(
      {
        // Manually increase the session memory to prevent 502 ENHANCE_YOUR_CALM
        // errors on large numbers of requests
        maxSessionMemory: 1000,
        ...httpsOptions,
        allowHTTP1: true,
      },
      // @ts-expect-error TODO: is this correct?
      app,
    )
  }
}
export async function resolveHttpsConfig(https) {
  if (!https) return undefined
  const [ca, cert, key, pfx] = await Promise.all([
    readFileIfExists(https.ca),
    readFileIfExists(https.cert),
    readFileIfExists(https.key),
    readFileIfExists(https.pfx),
  ])
  return { ...https, ca, cert, key, pfx }
}
async function readFileIfExists(value) {
  if (typeof value === 'string') {
    return fsp.readFile(path.resolve(value)).catch(() => value)
  }
  return value
}
export async function httpServerStart(httpServer, serverOptions) {
  let { port, strictPort, host, logger } = serverOptions
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      if (e.code === 'EADDRINUSE') {
        if (strictPort) {
          httpServer.removeListener('error', onError)
          reject(new Error(`Port ${port} is already in use`))
        } else {
          logger.info(`Port ${port} is in use, trying another one...`)
          httpServer.listen(++port, host)
        }
      } else {
        httpServer.removeListener('error', onError)
        reject(e)
      }
    }
    httpServer.on('error', onError)
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', onError)
      resolve(port)
    })
  })
}
export function setClientErrorHandler(server, logger) {
  server.on('clientError', (err, socket) => {
    let msg = '400 Bad Request'
    if (err.code === 'HPE_HEADER_OVERFLOW') {
      msg = '431 Request Header Fields Too Large'
      logger.warn(
        colors.yellow(
          'Server responded with status code 431. ' +
            'See https://vitejs.dev/guide/troubleshooting.html#_431-request-header-fields-too-large.',
        ),
      )
    }
    if (err.code === 'ECONNRESET' || !socket.writable) {
      return
    }
    socket.end(`HTTP/1.1 ${msg}\r\n\r\n`)
  })
}
