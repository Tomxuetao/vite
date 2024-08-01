import type { BuildOptions as EsbuildBuildOptions } from 'esbuild'
import type { ResolvedConfig } from '../config'
export {
  initDepsOptimizer,
  initDevSsrDepsOptimizer,
  getDepsOptimizer,
} from './optimizer'
export type ExportsData = {
  hasModuleSyntax: boolean
  exports: readonly string[]
  jsxLoader?: boolean
}
export interface DepsOptimizer {
  metadata: DepOptimizationMetadata
  scanProcessing?: Promise<void>
  registerMissingImport: (id: string, resolved: string) => OptimizedDepInfo
  run: () => void
  isOptimizedDepFile: (id: string) => boolean
  isOptimizedDepUrl: (url: string) => boolean
  getOptimizedDepId: (depInfo: OptimizedDepInfo) => string
  close: () => Promise<void>
  options: DepOptimizationOptions
}
export interface DepOptimizationConfig {
  /**
   * Force optimize listed dependencies (must be resolvable import paths,
   * cannot be globs).
   */
  include?: string[]
  /**
   * Do not optimize these dependencies (must be resolvable import paths,
   * cannot be globs).
   */
  exclude?: string[]
  /**
   * Forces ESM interop when importing these dependencies. Some legacy
   * packages advertise themselves as ESM but use `require` internally
   * @experimental
   */
  needsInterop?: string[]
  /**
   * Options to pass to esbuild during the dep scanning and optimization
   *
   * Certain options are omitted since changing them would not be compatible
   * with Vite's dep optimization.
   *
   * - `external` is also omitted, use Vite's `optimizeDeps.exclude` option
   * - `plugins` are merged with Vite's dep plugin
   *
   * https://esbuild.github.io/api
   */
  esbuildOptions?: Omit<
    EsbuildBuildOptions,
    | 'bundle'
    | 'entryPoints'
    | 'external'
    | 'write'
    | 'watch'
    | 'outdir'
    | 'outfile'
    | 'outbase'
    | 'outExtension'
    | 'metafile'
  >
  /**
   * List of file extensions that can be optimized. A corresponding esbuild
   * plugin must exist to handle the specific extension.
   *
   * By default, Vite can optimize `.mjs`, `.js`, `.ts`, and `.mts` files. This option
   * allows specifying additional extensions.
   *
   * @experimental
   */
  extensions?: string[]
  /**
   * Deps optimization during build was removed in Vite 5.1. This option is
   * now redundant and will be removed in a future version. Switch to using
   * `optimizeDeps.noDiscovery` and an empty or undefined `optimizeDeps.include`.
   * true or 'dev' disables the optimizer, false or 'build' leaves it enabled.
   * @default 'build'
   * @deprecated
   * @experimental
   */
  disabled?: boolean | 'build' | 'dev'
  /**
   * Automatic dependency discovery. When `noDiscovery` is true, only dependencies
   * listed in `include` will be optimized. The scanner isn't run for cold start
   * in this case. CJS-only dependencies must be present in `include` during dev.
   * @default false
   * @experimental
   */
  noDiscovery?: boolean
  /**
   * When enabled, it will hold the first optimized deps results until all static
   * imports are crawled on cold start. This avoids the need for full-page reloads
   * when new dependencies are discovered and they trigger the generation of new
   * common chunks. If all dependencies are found by the scanner plus the explicitly
   * defined ones in `include`, it is better to disable this option to let the
   * browser process more requests in parallel.
   * @default true
   * @experimental
   */
  holdUntilCrawlEnd?: boolean
}
export type DepOptimizationOptions = DepOptimizationConfig & {
  /**
   * By default, Vite will crawl your `index.html` to detect dependencies that
   * need to be pre-bundled. If `build.rollupOptions.input` is specified, Vite
   * will crawl those entry points instead.
   *
   * If neither of these fit your needs, you can specify custom entries using
   * this option - the value should be a fast-glob pattern or array of patterns
   * (https://github.com/mrmlnc/fast-glob#basic-syntax) that are relative from
   * vite project root. This will overwrite default entries inference.
   */
  entries?: string | string[]
  /**
   * Force dep pre-optimization regardless of whether deps have changed.
   * @experimental
   */
  force?: boolean
}
export interface DepOptimizationResult {
  metadata: DepOptimizationMetadata
  /**
   * When doing a re-run, if there are newly discovered dependencies
   * the page reload will be delayed until the next rerun so we need
   * to be able to discard the result
   */
  commit: () => Promise<void>
  cancel: () => void
}
export interface OptimizedDepInfo {
  id: string
  file: string
  src?: string
  needsInterop?: boolean
  browserHash?: string
  fileHash?: string
  /**
   * During optimization, ids can still be resolved to their final location
   * but the bundles may not yet be saved to disk
   */
  processing?: Promise<void>
  /**
   * ExportData cache, discovered deps will parse the src entry to get exports
   * data used both to define if interop is needed and when pre-bundling
   */
  exportsData?: Promise<ExportsData>
}
export interface DepOptimizationMetadata {
  /**
   * The main hash is determined by user config and dependency lockfiles.
   * This is checked on server startup to avoid unnecessary re-bundles.
   */
  hash: string
  /**
   * This hash is determined by dependency lockfiles.
   * This is checked on server startup to avoid unnecessary re-bundles.
   */
  lockfileHash: string
  /**
   * This hash is determined by user config.
   * This is checked on server startup to avoid unnecessary re-bundles.
   */
  configHash: string
  /**
   * The browser hash is determined by the main hash plus additional dependencies
   * discovered at runtime. This is used to invalidate browser requests to
   * optimized deps.
   */
  browserHash: string
  /**
   * Metadata for each already optimized dependency
   */
  optimized: Record<string, OptimizedDepInfo>
  /**
   * Metadata for non-entry optimized chunks and dynamic imports
   */
  chunks: Record<string, OptimizedDepInfo>
  /**
   * Metadata for each newly discovered dependency after processing
   */
  discovered: Record<string, OptimizedDepInfo>
  /**
   * OptimizedDepInfo list
   */
  depInfoList: OptimizedDepInfo[]
}
/**
 * Scan and optimize dependencies within a project.
 * Used by Vite CLI when running `vite optimize`.
 */
export declare function optimizeDeps(
  config: ResolvedConfig,
  force?: boolean | undefined,
  asCommand?: boolean,
): Promise<DepOptimizationMetadata>
export declare function optimizeServerSsrDeps(
  config: ResolvedConfig,
): Promise<DepOptimizationMetadata>
export declare function initDepsOptimizerMetadata(
  config: ResolvedConfig,
  ssr: boolean,
  timestamp?: string,
): DepOptimizationMetadata
export declare function addOptimizedDepInfo(
  metadata: DepOptimizationMetadata,
  type: 'optimized' | 'discovered' | 'chunks',
  depInfo: OptimizedDepInfo,
): OptimizedDepInfo
/**
 * Creates the initial dep optimization metadata, loading it from the deps cache
 * if it exists and pre-bundling isn't forced
 */
export declare function loadCachedDepOptimizationMetadata(
  config: ResolvedConfig,
  ssr: boolean,
  force?: boolean | undefined,
  asCommand?: boolean,
): Promise<DepOptimizationMetadata | undefined>
/**
 * Initial optimizeDeps at server start. Perform a fast scan using esbuild to
 * find deps to pre-bundle and include user hard-coded dependencies
 */
export declare function discoverProjectDependencies(config: ResolvedConfig): {
  cancel: () => Promise<void>
  result: Promise<Record<string, string>>
}
export declare function toDiscoveredDependencies(
  config: ResolvedConfig,
  deps: Record<string, string>,
  ssr: boolean,
  timestamp?: string,
): Record<string, OptimizedDepInfo>
export declare function depsLogString(qualifiedIds: string[]): string
/**
 * Internally, Vite uses this function to prepare a optimizeDeps run. When Vite starts, we can get
 * the metadata and start the server without waiting for the optimizeDeps processing to be completed
 */
export declare function runOptimizeDeps(
  resolvedConfig: ResolvedConfig,
  depsInfo: Record<string, OptimizedDepInfo>,
  ssr: boolean,
): {
  cancel: () => Promise<void>
  result: Promise<DepOptimizationResult>
}
export declare function addManuallyIncludedOptimizeDeps(
  deps: Record<string, string>,
  config: ResolvedConfig,
  ssr: boolean,
): Promise<void>
export declare function depsFromOptimizedDepInfo(
  depsInfo: Record<string, OptimizedDepInfo>,
): Record<string, string>
export declare function getOptimizedDepPath(
  id: string,
  config: ResolvedConfig,
  ssr: boolean,
): string
export declare function getDepsCacheDir(
  config: ResolvedConfig,
  ssr: boolean,
): string
export declare function createIsOptimizedDepFile(
  config: ResolvedConfig,
): (id: string) => boolean
export declare function createIsOptimizedDepUrl(
  config: ResolvedConfig,
): (url: string) => boolean
export declare function extractExportsData(
  filePath: string,
  config: ResolvedConfig,
  ssr: boolean,
): Promise<ExportsData>
export declare function optimizedDepInfoFromId(
  metadata: DepOptimizationMetadata,
  id: string,
): OptimizedDepInfo | undefined
export declare function optimizedDepInfoFromFile(
  metadata: DepOptimizationMetadata,
  file: string,
): OptimizedDepInfo | undefined
export declare function optimizedDepNeedsInterop(
  metadata: DepOptimizationMetadata,
  file: string,
  config: ResolvedConfig,
  ssr: boolean,
): Promise<boolean | undefined>
export declare function cleanupDepsCacheStaleDirs(
  config: ResolvedConfig,
): Promise<void>
