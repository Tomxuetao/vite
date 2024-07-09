/// <reference types="node" />
/// <reference types="node" />
import type { Server } from 'node:http'
import type { EventEmitter } from 'node:events'
import type { CustomPayload, HMRPayload } from 'types/hmrPayload'
import type { InferCustomEventPayload, ViteDevServer } from '..'
import type { ModuleNode } from './moduleGraph'
export declare const debugHmr: ((...args: any[]) => any) | undefined
export interface HmrOptions {
  protocol?: string
  host?: string
  port?: number
  clientPort?: number
  path?: string
  timeout?: number
  overlay?: boolean
  server?: Server
}
export interface HmrContext {
  file: string
  timestamp: number
  modules: Array<ModuleNode>
  read: () => string | Promise<string>
  server: ViteDevServer
}
export interface HMRBroadcasterClient {
  /**
   * Send event to the client
   */
  send(payload: HMRPayload): void
  /**
   * Send custom event
   */
  send(event: string, payload?: CustomPayload['data']): void
}
export interface HMRChannel {
  /**
   * Unique channel name
   */
  name: string
  /**
   * Broadcast events to all clients
   */
  send(payload: HMRPayload): void
  /**
   * Send custom event
   */
  send<T extends string>(event: T, payload?: InferCustomEventPayload<T>): void
  /**
   * Handle custom event emitted by `import.meta.hot.send`
   */
  on<T extends string>(
    event: T,
    listener: (
      data: InferCustomEventPayload<T>,
      client: HMRBroadcasterClient,
      ...args: any[]
    ) => void,
  ): void
  on(event: 'connection', listener: () => void): void
  /**
   * Unregister event listener
   */
  off(event: string, listener: Function): void
  /**
   * Start listening for messages
   */
  listen(): void
  /**
   * Disconnect all clients, called when server is closed or restarted.
   */
  close(): void
}
export interface HMRBroadcaster extends Omit<HMRChannel, 'close' | 'name'> {
  /**
   * All registered channels. Always has websocket channel.
   */
  readonly channels: HMRChannel[]
  /**
   * Add a new third-party channel.
   */
  addChannel(connection: HMRChannel): HMRBroadcaster
  close(): Promise<unknown[]>
}
export declare function getShortName(file: string, root: string): string
export declare function handleHMRUpdate(
  type: 'create' | 'delete' | 'update',
  file: string,
  server: ViteDevServer,
): Promise<void>
export declare function updateModules(
  file: string,
  modules: ModuleNode[],
  timestamp: number,
  { config, hot, moduleGraph }: ViteDevServer,
  afterInvalidation?: boolean,
): void
export declare function handlePrunedModules(
  mods: Set<ModuleNode>,
  { hot }: ViteDevServer,
): void
/**
 * Lex import.meta.hot.accept() for accepted deps.
 * Since hot.accept() can only accept string literals or array of string
 * literals, we don't really need a heavy @babel/parse call on the entire source.
 *
 * @returns selfAccepts
 */
export declare function lexAcceptedHmrDeps(
  code: string,
  start: number,
  urls: Set<{
    url: string
    start: number
    end: number
  }>,
): boolean
export declare function lexAcceptedHmrExports(
  code: string,
  start: number,
  exportNames: Set<string>,
): boolean
export declare function normalizeHmrUrl(url: string): string
export declare function createHMRBroadcaster(): HMRBroadcaster
export interface ServerHMRChannel extends HMRChannel {
  api: {
    innerEmitter: EventEmitter
    outsideEmitter: EventEmitter
  }
}
export declare function createServerHMRChannel(): ServerHMRChannel
