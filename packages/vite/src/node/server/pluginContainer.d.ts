/**
 * This file is refactored into TypeScript based on
 * https://github.com/preactjs/wmr/blob/main/packages/wmr/src/lib/rollup-plugin-container.js
 */
import type {
  CustomPluginOptions,
  EmittedFile,
  InputOptions,
  LoadResult,
  MinimalPluginContext,
  ModuleInfo,
  ModuleOptions,
  OutputOptions,
  PartialNull,
  PartialResolvedId,
  RollupError,
  RollupLog,
  PluginContext as RollupPluginContext,
  TransformPluginContext as RollupTransformPluginContext,
  SourceDescription,
  SourceMap,
  TransformResult,
} from 'rollup'
import type { FSWatcher } from 'dep-types/chokidar'
import type { Plugin } from '../plugin'
import type { PluginHookUtils, ResolvedConfig } from '../config'
import type { ModuleGraph } from './moduleGraph'
export declare const ERR_CLOSED_SERVER = 'ERR_CLOSED_SERVER'
export declare function throwClosedServerError(): never
export interface PluginContainerOptions {
  cwd?: string
  output?: OutputOptions
  modules?: Map<
    string,
    {
      info: ModuleInfo
    }
  >
  writeFile?: (name: string, source: string | Uint8Array) => void
}
export declare function createPluginContainer(
  config: ResolvedConfig,
  moduleGraph?: ModuleGraph,
  watcher?: FSWatcher,
): Promise<PluginContainer>
declare class PluginContainer {
  config: ResolvedConfig
  moduleGraph?: ModuleGraph | undefined
  watcher?: FSWatcher | undefined
  plugins: readonly Plugin<any>[]
  private _pluginContextMap
  private _pluginContextMapSsr
  private _resolvedRollupOptions?
  private _processesing
  private _seenResolves
  private _closed
  private _moduleNodeToLoadAddedImports
  getSortedPluginHooks: PluginHookUtils['getSortedPluginHooks']
  getSortedPlugins: PluginHookUtils['getSortedPlugins']
  watchFiles: Set<string>
  minimalContext: MinimalPluginContext
  private _updateModuleLoadAddedImports
  private _getAddedImports
  getModuleInfo(id: string): ModuleInfo | null
  private handleHookPromise
  get options(): InputOptions
  resolveRollupOptions(): Promise<InputOptions>
  private _getPluginContext
  private hookParallel
  buildStart(_options?: InputOptions): Promise<void>
  resolveId(
    rawId: string,
    importer?: string | undefined,
    options?: {
      attributes?: Record<string, string>
      custom?: CustomPluginOptions
      skip?: Set<Plugin>
      ssr?: boolean
      isEntry?: boolean
    },
  ): Promise<PartialResolvedId | null>
  load(
    id: string,
    options?: {
      ssr?: boolean
    },
  ): Promise<LoadResult | null>
  transform(
    code: string,
    id: string,
    options?: {
      ssr?: boolean
      inMap?: SourceDescription['map']
    },
  ): Promise<{
    code: string
    map:
      | SourceMap
      | {
          mappings: ''
        }
      | null
  }>
  watchChange(
    id: string,
    change: {
      event: 'create' | 'update' | 'delete'
    },
  ): Promise<void>
  close(): Promise<void>
}
declare class PluginContext implements Omit<RollupPluginContext, 'cache'> {
  _plugin: Plugin
  _container: PluginContainer
  ssr: boolean
  protected _scan: boolean
  protected _resolveSkips?: Set<Plugin>
  protected _activeId: string | null
  protected _activeCode: string | null
  meta: RollupPluginContext['meta']
  constructor(_plugin: Plugin, _container: PluginContainer, ssr: boolean)
  parse(code: string, opts: any): ReturnType<RollupPluginContext['parse']>
  getModuleInfo(id: string): ModuleInfo | null
  resolve(
    id: string,
    importer?: string,
    options?: {
      attributes?: Record<string, string>
      custom?: CustomPluginOptions
      isEntry?: boolean
      skipSelf?: boolean
    },
  ): ReturnType<RollupPluginContext['resolve']>
  load(
    options: {
      id: string
      resolveDependencies?: boolean
    } & Partial<PartialNull<ModuleOptions>>,
  ): Promise<ModuleInfo>
  _updateModuleInfo(
    id: string,
    {
      meta,
    }: {
      meta?: object | null
    },
  ): void
  getModuleIds(): IterableIterator<string>
  addWatchFile(id: string): void
  getWatchFiles(): string[]
  emitFile(assetOrFile: EmittedFile): string
  setAssetSource(): void
  getFileName(): string
  warn(
    e: string | RollupLog | (() => string | RollupLog),
    position?:
      | number
      | {
          column: number
          line: number
        },
  ): void
  error(
    e: string | RollupError,
    position?:
      | number
      | {
          column: number
          line: number
        },
  ): never
  debug: () => void
  info: () => void
  private _formatError
  _warnIncompatibleMethod(method: string): void
}
declare class LoadPluginContext extends PluginContext {
  _addedImports: Set<string> | null
  constructor(container: PluginContainer, ssr: boolean)
  addWatchFile(id: string): void
}
declare class TransformPluginContext
  extends LoadPluginContext
  implements Omit<RollupTransformPluginContext, 'cache'>
{
  filename: string
  originalCode: string
  originalSourcemap: SourceMap | null
  sourcemapChain: NonNullable<SourceDescription['map']>[]
  combinedMap:
    | SourceMap
    | {
        mappings: ''
      }
    | null
  constructor(
    container: PluginContainer,
    id: string,
    code: string,
    inMap: SourceMap | string | undefined,
    ssr: boolean,
  )
  _getCombinedSourcemap(): SourceMap
  getCombinedSourcemap(): SourceMap
  _updateActiveInfo(plugin: Plugin, id: string, code: string): void
}
export type {
  PluginContainer,
  PluginContext,
  TransformPluginContext,
  TransformResult,
}
