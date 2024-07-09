import type { Alias, AliasOptions, ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
/**
 * A plugin to avoid an aliased AND optimized dep from being aliased in src
 */
export declare function preAliasPlugin(config: ResolvedConfig): Plugin
export declare function getAliasPatternMatcher(
  entries: (AliasOptions | undefined) & Alias[],
): (importee: string) => boolean
