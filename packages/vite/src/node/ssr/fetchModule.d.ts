import type { TransformResult, ViteDevServer } from '..'
import type { FetchResult } from '../../runtime/types'
export interface FetchModuleOptions {
  inlineSourceMap?: boolean
  processSourceMap?<T extends NonNullable<TransformResult['map']>>(map: T): T
}
/**
 * Fetch module information for Vite runtime.
 * @experimental
 */
export declare function fetchModule(
  server: ViteDevServer,
  url: string,
  importer?: string,
  options?: FetchModuleOptions,
): Promise<FetchResult>
