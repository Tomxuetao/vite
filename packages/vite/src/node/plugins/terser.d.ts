import type { Terser } from 'dep-types/terser'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '..'
export interface TerserOptions extends Terser.MinifyOptions {
  /**
   * Vite-specific option to specify the max number of workers to spawn
   * when minifying files with terser.
   *
   * @default number of CPUs minus 1
   */
  maxWorkers?: number
}
export declare function terserPlugin(config: ResolvedConfig): Plugin
