/// <reference types="node" />
/// <reference types="node" />
import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http'
import type { SourceMap } from 'rollup'
export interface SendOptions {
  etag?: string
  cacheControl?: string
  headers?: OutgoingHttpHeaders
  map?:
    | SourceMap
    | {
        mappings: ''
      }
    | null
}
export declare function send(
  req: IncomingMessage,
  res: ServerResponse,
  content: string | Buffer,
  type: string,
  options: SendOptions,
): void
