/// <reference types="node" />
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import type { WebSocket as WebSocketTypes } from 'dep-types/ws'
import type { CustomPayload, HMRPayload } from 'types/hmrPayload'
import type { InferCustomEventPayload } from 'types/customEvent'
import type { ResolvedConfig } from '..'
import type { HMRChannel } from './hmr'
import type { HttpServer } from '.'
export declare const HMR_HEADER = 'vite-hmr'
export type WebSocketCustomListener<T> = (
  data: T,
  client: WebSocketClient,
) => void
export interface WebSocketServer extends HMRChannel {
  /**
   * Listen on port and host
   */
  listen(): void
  /**
   * Get all connected clients.
   */
  clients: Set<WebSocketClient>
  /**
   * Disconnect all clients and terminate the server.
   */
  close(): Promise<void>
  /**
   * Handle custom event emitted by `import.meta.hot.send`
   */
  on: WebSocketTypes.Server['on'] & {
    <T extends string>(
      event: T,
      listener: WebSocketCustomListener<InferCustomEventPayload<T>>,
    ): void
  }
  /**
   * Unregister event listener.
   */
  off: WebSocketTypes.Server['off'] & {
    (event: string, listener: Function): void
  }
}
export interface WebSocketClient {
  /**
   * Send event to the client
   */
  send(payload: HMRPayload): void
  /**
   * Send custom event
   */
  send(event: string, payload?: CustomPayload['data']): void
  /**
   * The raw WebSocket instance
   * @advanced
   */
  socket: WebSocketTypes
}
export declare function createWebSocketServer(
  server: HttpServer | null,
  config: ResolvedConfig,
  httpsOptions?: HttpsServerOptions,
): WebSocketServer
