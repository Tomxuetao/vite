import type { ViteRuntime } from '../runtime'
interface RetrieveFileHandler {
  (path: string): string | null | undefined | false
}
interface RetrieveSourceMapHandler {
  (path: string): null | {
    url: string
    map: any
  }
}
export interface InterceptorOptions {
  retrieveFile?: RetrieveFileHandler
  retrieveSourceMap?: RetrieveSourceMapHandler
}
export declare function interceptStackTrace(
  runtime: ViteRuntime,
  options?: InterceptorOptions,
): () => void
export {}
