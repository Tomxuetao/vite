class ServerHMRBroadcasterClient {
  hmrChannel
  constructor(hmrChannel) {
    this.hmrChannel = hmrChannel
  }
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
    if (payload.type !== 'custom') {
      throw new Error(
        'Cannot send non-custom events from the client to the server.',
      )
    }
    this.hmrChannel.send(payload)
  }
}
/**
 * The connector class to establish HMR communication between the server and the Vite runtime.
 * @experimental
 */
export class ServerHMRConnector {
  handlers = []
  hmrChannel
  hmrClient
  connected = false
  constructor(server) {
    const hmrChannel = server.hot?.channels.find((c) => c.name === 'ssr')
    if (!hmrChannel) {
      throw new Error(
        "Your version of Vite doesn't support HMR during SSR. Please, use Vite 5.1 or higher.",
      )
    }
    this.hmrClient = new ServerHMRBroadcasterClient(hmrChannel)
    hmrChannel.api.outsideEmitter.on('send', (payload) => {
      this.handlers.forEach((listener) => listener(payload))
    })
    this.hmrChannel = hmrChannel
  }
  isReady() {
    return this.connected
  }
  send(message) {
    const payload = JSON.parse(message)
    this.hmrChannel.api.innerEmitter.emit(
      payload.event,
      payload.data,
      this.hmrClient,
    )
  }
  onUpdate(handler) {
    this.handlers.push(handler)
    handler({ type: 'connected' })
    this.connected = true
  }
}
