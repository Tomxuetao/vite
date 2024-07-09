import path from 'node:path'
import { STATUS_CODES, createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import colors from 'picocolors'
import { WebSocketServer as WebSocketServerRaw_ } from 'ws'
import { isObject } from '../utils'
/* In Bun, the `ws` module is overridden to hook into the native code. Using the bundled `js` version
 * of `ws` will not work as Bun's req.socket does not allow reading/writing to the underlying socket.
 */
const WebSocketServerRaw = process.versions.bun
  ? // @ts-expect-error: Bun defines `import.meta.require`
    import.meta.require('ws').WebSocketServer
  : WebSocketServerRaw_
export const HMR_HEADER = 'vite-hmr'
const wsServerEvents = [
  'connection',
  'error',
  'headers',
  'listening',
  'message',
]
function noop() {
  // noop
}
export function createWebSocketServer(server, config, httpsOptions) {
  if (config.server.ws === false) {
    return {
      name: 'ws',
      get clients() {
        return new Set()
      },
      async close() {
        // noop
      },
      on: noop,
      off: noop,
      listen: noop,
      send: noop,
    }
  }
  let wss
  let wsHttpServer = undefined
  const hmr = isObject(config.server.hmr) && config.server.hmr
  const hmrServer = hmr && hmr.server
  const hmrPort = hmr && hmr.port
  // TODO: the main server port may not have been chosen yet as it may use the next available
  const portsAreCompatible = !hmrPort || hmrPort === config.server.port
  const wsServer = hmrServer || (portsAreCompatible && server)
  let hmrServerWsListener
  const customListeners = new Map()
  const clientsMap = new WeakMap()
  const port = hmrPort || 24678
  const host = (hmr && hmr.host) || undefined
  if (wsServer) {
    let hmrBase = config.base
    const hmrPath = hmr ? hmr.path : undefined
    if (hmrPath) {
      hmrBase = path.posix.join(hmrBase, hmrPath)
    }
    wss = new WebSocketServerRaw({ noServer: true })
    hmrServerWsListener = (req, socket, head) => {
      if (
        req.headers['sec-websocket-protocol'] === HMR_HEADER &&
        req.url === hmrBase
      ) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      }
    }
    wsServer.on('upgrade', hmrServerWsListener)
  } else {
    // http server request handler keeps the same with
    // https://github.com/websockets/ws/blob/45e17acea791d865df6b255a55182e9c42e5877a/lib/websocket-server.js#L88-L96
    const route = (_, res) => {
      const statusCode = 426
      const body = STATUS_CODES[statusCode]
      if (!body)
        throw new Error(`No body text found for the ${statusCode} status code`)
      res.writeHead(statusCode, {
        'Content-Length': body.length,
        'Content-Type': 'text/plain',
      })
      res.end(body)
    }
    if (httpsOptions) {
      wsHttpServer = createHttpsServer(httpsOptions, route)
    } else {
      wsHttpServer = createHttpServer(route)
    }
    // vite dev server in middleware mode
    // need to call ws listen manually
    wss = new WebSocketServerRaw({ server: wsHttpServer })
  }
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      if (!customListeners.size) return
      let parsed
      try {
        parsed = JSON.parse(String(raw))
      } catch {}
      if (!parsed || parsed.type !== 'custom' || !parsed.event) return
      const listeners = customListeners.get(parsed.event)
      if (!listeners?.size) return
      const client = getSocketClient(socket)
      listeners.forEach((listener) => listener(parsed.data, client))
    })
    socket.on('error', (err) => {
      config.logger.error(`${colors.red(`ws error:`)}\n${err.stack}`, {
        timestamp: true,
        error: err,
      })
    })
    socket.send(JSON.stringify({ type: 'connected' }))
    if (bufferedError) {
      socket.send(JSON.stringify(bufferedError))
      bufferedError = null
    }
  })
  wss.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      config.logger.error(
        colors.red(`WebSocket server error: Port is already in use`),
        { error: e },
      )
    } else {
      config.logger.error(
        colors.red(`WebSocket server error:\n${e.stack || e.message}`),
        { error: e },
      )
    }
  })
  // Provide a wrapper to the ws client so we can send messages in JSON format
  // To be consistent with server.ws.send
  function getSocketClient(socket) {
    if (!clientsMap.has(socket)) {
      clientsMap.set(socket, {
        send: (...args) => {
          let payload
          if (typeof args[0] === 'string') {
            payload = {
              type: 'custom',
              event: args[0],
              data: args[1],
            }
          } else {
            payload = args[0]
          }
          socket.send(JSON.stringify(payload))
        },
        socket,
      })
    }
    return clientsMap.get(socket)
  }
  // On page reloads, if a file fails to compile and returns 500, the server
  // sends the error payload before the client connection is established.
  // If we have no open clients, buffer the error and send it to the next
  // connected client.
  let bufferedError = null
  return {
    name: 'ws',
    listen: () => {
      wsHttpServer?.listen(port, host)
    },
    on: (event, fn) => {
      if (wsServerEvents.includes(event)) wss.on(event, fn)
      else {
        if (!customListeners.has(event)) {
          customListeners.set(event, new Set())
        }
        customListeners.get(event).add(fn)
      }
    },
    off: (event, fn) => {
      if (wsServerEvents.includes(event)) {
        wss.off(event, fn)
      } else {
        customListeners.get(event)?.delete(fn)
      }
    },
    get clients() {
      return new Set(Array.from(wss.clients).map(getSocketClient))
    },
    send(...args) {
      let payload
      if (typeof args[0] === 'string') {
        payload = {
          type: 'custom',
          event: args[0],
          data: args[1],
        }
      } else {
        payload = args[0]
      }
      if (payload.type === 'error' && !wss.clients.size) {
        bufferedError = payload
        return
      }
      const stringified = JSON.stringify(payload)
      wss.clients.forEach((client) => {
        // readyState 1 means the connection is open
        if (client.readyState === 1) {
          client.send(stringified)
        }
      })
    },
    close() {
      // should remove listener if hmr.server is set
      // otherwise the old listener swallows all WebSocket connections
      if (hmrServerWsListener && wsServer) {
        wsServer.off('upgrade', hmrServerWsListener)
      }
      return new Promise((resolve, reject) => {
        wss.clients.forEach((client) => {
          client.terminate()
        })
        wss.close((err) => {
          if (err) {
            reject(err)
          } else {
            if (wsHttpServer) {
              wsHttpServer.close((err) => {
                if (err) {
                  reject(err)
                } else {
                  resolve()
                }
              })
            } else {
              resolve()
            }
          }
        })
      })
    },
  }
}
