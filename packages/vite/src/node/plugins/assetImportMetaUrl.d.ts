import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
/**
 * Convert `new URL('./foo.png', import.meta.url)` to its resolved built URL
 *
 * Supports template string with dynamic segments:
 * ```
 * new URL(`./dir/${name}.png`, import.meta.url)
 * // transformed to
 * import.meta.glob('./dir/**.png', { eager: true, import: 'default' })[`./dir/${name}.png`]
 * ```
 */
export declare function assetImportMetaUrlPlugin(config: ResolvedConfig): Plugin
