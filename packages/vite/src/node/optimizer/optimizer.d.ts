import type { ResolvedConfig, ViteDevServer } from '..'
import type { DepsOptimizer } from '.'
export declare function getDepsOptimizer(
  config: ResolvedConfig,
  ssr?: boolean,
): DepsOptimizer | undefined
export declare function initDepsOptimizer(
  config: ResolvedConfig,
  server: ViteDevServer,
): Promise<void>
export declare function initDevSsrDepsOptimizer(
  config: ResolvedConfig,
  server: ViteDevServer,
): Promise<void>
