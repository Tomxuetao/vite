import type {
  ExistingRawSourceMap,
  ModuleFormat,
  RenderedChunk,
  RollupError,
  SourceMapInput,
} from 'rollup'
import type * as PostCSS from 'postcss'
import type { Alias } from 'dep-types/alias'
import type { LightningCSSOptions } from 'dep-types/lightningcss'
import type { ResolveFn } from '../'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import type { Logger } from '../logger'
import type { ESBuildOptions } from './esbuild'
export interface CSSOptions {
  /**
   * Using lightningcss is an experimental option to handle CSS modules,
   * assets and imports via Lightning CSS. It requires to install it as a
   * peer dependency. This is incompatible with the use of preprocessors.
   *
   * @default 'postcss'
   * @experimental
   */
  transformer?: 'postcss' | 'lightningcss'
  /**
   * https://github.com/css-modules/postcss-modules
   */
  modules?: CSSModulesOptions | false
  /**
   * Options for preprocessors.
   *
   * In addition to options specific to each processors, Vite supports `additionalData` option.
   * The `additionalData` option can be used to inject extra code for each style content.
   */
  preprocessorOptions?: Record<string, any>
  /**
   * If this option is set, preprocessors will run in workers when possible.
   * `true` means the number of CPUs minus 1.
   *
   * @default 0
   * @experimental
   */
  preprocessorMaxWorkers?: number | true
  postcss?:
    | string
    | (PostCSS.ProcessOptions & {
        plugins?: PostCSS.AcceptedPlugin[]
      })
  /**
   * Enables css sourcemaps during dev
   * @default false
   * @experimental
   */
  devSourcemap?: boolean
  /**
   * @experimental
   */
  lightningcss?: LightningCSSOptions
}
export interface CSSModulesOptions {
  getJSON?: (
    cssFileName: string,
    json: Record<string, string>,
    outputFileName: string,
  ) => void
  scopeBehaviour?: 'global' | 'local'
  globalModulePaths?: RegExp[]
  exportGlobals?: boolean
  generateScopedName?:
    | string
    | ((name: string, filename: string, css: string) => string)
  hashPrefix?: string
  /**
   * default: undefined
   */
  localsConvention?:
    | 'camelCase'
    | 'camelCaseOnly'
    | 'dashes'
    | 'dashesOnly'
    | ((
        originalClassName: string,
        generatedClassName: string,
        inputFile: string,
      ) => string)
}
export type ResolvedCSSOptions = Omit<CSSOptions, 'lightningcss'> & {
  lightningcss?: LightningCSSOptions & {
    targets: LightningCSSOptions['targets']
  }
}
export declare function resolveCSSOptions(
  options: CSSOptions | undefined,
): ResolvedCSSOptions
export declare const isCSSRequest: (request: string) => boolean
export declare const isModuleCSSRequest: (request: string) => boolean
export declare const isDirectCSSRequest: (request: string) => boolean
export declare const isDirectRequest: (request: string) => boolean
export declare const removedPureCssFilesCache: WeakMap<
  Readonly<
    Omit<
      import('../config').UserConfig,
      'css' | 'plugins' | 'assetsInclude' | 'optimizeDeps' | 'worker' | 'build'
    > & {
      configFile: string | undefined
      configFileDependencies: string[]
      inlineConfig: import('../config').InlineConfig
      root: string
      base: string
      rawBase: string
      publicDir: string
      cacheDir: string
      command: 'build' | 'serve'
      mode: string
      isWorker: boolean
      mainConfig: Readonly<
        Omit<
          import('../config').UserConfig,
          | 'css'
          | 'plugins'
          | 'assetsInclude'
          | 'optimizeDeps'
          | 'worker'
          | 'build'
        > &
          any &
          import('../config').PluginHookUtils
      > | null
      bundleChain: string[]
      isProduction: boolean
      envDir: string
      env: Record<string, any>
      resolve: Required<import('./resolve').ResolveOptions> & {
        alias: Alias[]
      }
      plugins: readonly Plugin<any>[]
      css: ResolvedCSSOptions
      esbuild: false | ESBuildOptions
      server: import('../server').ResolvedServerOptions
      build: import('../build').ResolvedBuildOptions
      preview: import('../preview').ResolvedPreviewOptions
      ssr: import('../ssr').ResolvedSSROptions
      assetsInclude: (file: string) => boolean
      logger: Logger
      createResolver: (
        options?:
          | Partial<import('./resolve').InternalResolveOptions>
          | undefined,
      ) => ResolveFn
      optimizeDeps: import('../optimizer').DepOptimizationOptions
      packageCache: import('../packages').PackageCache
      worker: import('../config').ResolvedWorkerOptions
      appType: import('../config').AppType
      experimental: import('../config').ExperimentalOptions
    } & import('../config').PluginHookUtils
  >,
  Map<string, RenderedChunk>
>
/**
 * Plugin applied before user plugins
 */
export declare function cssPlugin(config: ResolvedConfig): Plugin
/**
 * Plugin applied after user plugins
 */
export declare function cssPostPlugin(config: ResolvedConfig): Plugin
export declare function cssAnalysisPlugin(config: ResolvedConfig): Plugin
/**
 * Create a replacer function that takes code and replaces given pure CSS chunk imports
 * @param pureCssChunkNames The chunks that only contain pure CSS and should be replaced
 * @param outputFormat The module output format to decide whether to replace `import` or `require`
 */
export declare function getEmptyChunkReplacer(
  pureCssChunkNames: string[],
  outputFormat: ModuleFormat,
): (code: string) => string
export interface PreprocessCSSResult {
  code: string
  map?: SourceMapInput
  modules?: Record<string, string>
  deps?: Set<string>
}
/**
 * @experimental
 */
export declare function preprocessCSS(
  code: string,
  filename: string,
  config: ResolvedConfig,
): Promise<PreprocessCSSResult>
export declare function formatPostcssSourceMap(
  rawMap: ExistingRawSourceMap,
  file: string,
): Promise<ExistingRawSourceMap>
export declare const cssUrlRE: RegExp
export declare const cssDataUriRE: RegExp
export declare const importCssRE: RegExp
export declare function hoistAtRules(css: string): Promise<string>
export interface StylePreprocessorResults {
  code: string
  map?: ExistingRawSourceMap | undefined
  additionalMap?: ExistingRawSourceMap | undefined
  error?: RollupError
  deps: string[]
}
export declare const convertTargets: (
  esbuildTarget: string | string[] | false,
) => LightningCSSOptions['targets']
