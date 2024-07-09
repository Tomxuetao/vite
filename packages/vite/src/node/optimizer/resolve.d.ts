import type { ResolvedConfig } from '../config'
export declare function createOptimizeDepsIncludeResolver(
  config: ResolvedConfig,
  ssr: boolean,
): (id: string) => Promise<string | undefined>
/**
 * Expand the glob syntax in `optimizeDeps.include` to proper import paths
 */
export declare function expandGlobIds(
  id: string,
  config: ResolvedConfig,
): string[]
