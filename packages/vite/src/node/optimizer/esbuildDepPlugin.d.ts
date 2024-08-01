import type { Plugin } from 'esbuild'
import type { ResolvedConfig } from '../config'
export declare function esbuildDepPlugin(
  qualified: Record<string, string>,
  external: string[],
  config: ResolvedConfig,
  ssr: boolean,
): Plugin
export declare function esbuildCjsExternalPlugin(
  externals: string[],
  platform: 'node' | 'browser',
): Plugin
