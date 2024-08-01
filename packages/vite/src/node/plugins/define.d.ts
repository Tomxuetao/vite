import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
export declare function definePlugin(config: ResolvedConfig): Plugin
export declare function replaceDefine(
  code: string,
  id: string,
  define: Record<string, string>,
  config: ResolvedConfig,
): Promise<{
  code: string
  map: string | null
}>
/**
 * Like `JSON.stringify` but keeps raw string values as a literal
 * in the generated code. For example: `"window"` would refer to
 * the global `window` object directly.
 */
export declare function serializeDefine(define: Record<string, any>): string
