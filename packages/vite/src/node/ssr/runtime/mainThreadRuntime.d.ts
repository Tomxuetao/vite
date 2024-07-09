import type { ViteModuleRunner , ViteRuntime, ViteRuntimeOptions } from 'vite/runtime'
import type { ViteDevServer } from '../../server'
import type { HMRLogger } from '../../../shared/hmr'
/**
 * @experimental
 */
export interface MainThreadRuntimeOptions
  extends Omit<ViteRuntimeOptions, 'root' | 'fetchModule' | 'hmr'> {
  /**
   * Disable HMR or configure HMR logger.
   */
  hmr?:
    | false
    | {
        logger?: false | HMRLogger
      }
  /**
   * Provide a custom module runner. This controls how the code is executed.
   */
  runner?: ViteModuleRunner
}
/**
 * Create an instance of the Vite SSR runtime that support HMR.
 * @experimental
 */
export declare function createViteRuntime(
  server: ViteDevServer,
  options?: MainThreadRuntimeOptions,
): Promise<ViteRuntime>
