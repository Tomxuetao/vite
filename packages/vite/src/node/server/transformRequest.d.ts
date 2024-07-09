import type { SourceMap } from 'rollup'
import type { ViteDevServer } from '..'
export declare const ERR_LOAD_URL = 'ERR_LOAD_URL'
export declare const ERR_LOAD_PUBLIC_URL = 'ERR_LOAD_PUBLIC_URL'
export interface TransformResult {
  code: string
  map:
    | SourceMap
    | {
        mappings: ''
      }
    | null
  etag?: string
  deps?: string[]
  dynamicDeps?: string[]
}
export interface TransformOptions {
  ssr?: boolean
  html?: boolean
}
export declare function transformRequest(
  url: string,
  server: ViteDevServer,
  options?: TransformOptions,
): Promise<TransformResult | null>
