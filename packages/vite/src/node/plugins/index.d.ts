import { type ResolverFunction } from '@rollup/plugin-alias'
import type { ObjectHook } from 'rollup'
import type { PluginHookUtils, ResolvedConfig } from '../config'
import type { HookHandler, Plugin, PluginWithRequiredHook } from '../plugin'
export declare function resolvePlugins(
  config: ResolvedConfig,
  prePlugins: Plugin[],
  normalPlugins: Plugin[],
  postPlugins: Plugin[],
): Promise<Plugin[]>
export declare function createPluginHookUtils(
  plugins: readonly Plugin[],
): PluginHookUtils
export declare function getSortedPluginsByHook<K extends keyof Plugin>(
  hookName: K,
  plugins: readonly Plugin[],
): PluginWithRequiredHook<K>[]
export declare function getHookHandler<T extends ObjectHook<Function>>(
  hook: T,
): HookHandler<T>
export declare const viteAliasCustomResolver: ResolverFunction
