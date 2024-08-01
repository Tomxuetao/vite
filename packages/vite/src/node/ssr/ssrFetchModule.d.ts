import type { ViteDevServer } from '../server'
import type { FetchResult } from '../../runtime/types'
export declare function ssrFetchModule(
  server: ViteDevServer,
  id: string,
  importer?: string,
): Promise<FetchResult>
