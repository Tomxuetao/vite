import type { HMRPayload } from 'types/hmrPayload'
import type { HMRRuntimeConnection } from 'vite/runtime'
import type { ViteDevServer } from '../../server'
/**
 * The connector class to establish HMR communication between the server and the Vite runtime.
 * @experimental
 */
export declare class ServerHMRConnector implements HMRRuntimeConnection {
  private handlers
  private hmrChannel
  private hmrClient
  private connected
  constructor(server: ViteDevServer)
  isReady(): boolean
  send(message: string): void
  onUpdate(handler: (payload: HMRPayload) => void): void
}
