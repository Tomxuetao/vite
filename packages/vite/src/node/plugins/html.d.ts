import type { OutputBundle, OutputChunk, SourceMapInput } from 'rollup'
import type MagicString from 'magic-string'
import type { DefaultTreeAdapterMap, Token } from 'parse5'
import type { Plugin } from '../plugin'
import type { ViteDevServer } from '../server'
import type { ResolvedConfig } from '../config'
import type { Logger } from '../logger'
interface ScriptAssetsUrl {
  start: number
  end: number
  url: string
}
export declare const isHTMLProxy: (id: string) => boolean
export declare const isHTMLRequest: (request: string) => boolean
export declare const htmlProxyMap: WeakMap<
  Readonly<
    Omit<
      import('../config').UserConfig,
      'plugins' | 'css' | 'assetsInclude' | 'optimizeDeps' | 'worker' | 'build'
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
          | 'plugins'
          | 'css'
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
        alias: import('dep-types/alias').Alias[]
      }
      plugins: readonly Plugin<any>[]
      css: import('./css').ResolvedCSSOptions
      esbuild: false | import('./esbuild').ESBuildOptions
      server: import('../server').ResolvedServerOptions
      build: import('../build').ResolvedBuildOptions
      preview: import('..').ResolvedPreviewOptions
      ssr: import('..').ResolvedSSROptions
      assetsInclude: (file: string) => boolean
      logger: Logger
      createResolver: (
        options?:
          | Partial<import('./resolve').InternalResolveOptions>
          | undefined,
      ) => import('../config').ResolveFn
      optimizeDeps: import('..').DepOptimizationOptions
      packageCache: import('../packages').PackageCache
      worker: import('../config').ResolvedWorkerOptions
      appType: import('../config').AppType
      experimental: import('../config').ExperimentalOptions
    } & import('../config').PluginHookUtils
  >,
  Map<
    string,
    {
      code: string
      map?: SourceMapInput | undefined
    }[]
  >
>
export declare const htmlProxyResult: Map<string, string>
export declare function htmlInlineProxyPlugin(config: ResolvedConfig): Plugin
export declare function addToHTMLProxyCache(
  config: ResolvedConfig,
  filePath: string,
  index: number,
  result: {
    code: string
    map?: SourceMapInput
  },
): void
export declare function addToHTMLProxyTransformResult(
  hash: string,
  code: string,
): void
export declare const assetAttrsConfig: Record<string, string[]>
export declare const isAsyncScriptMap: WeakMap<
  Readonly<
    Omit<
      import('../config').UserConfig,
      'plugins' | 'css' | 'assetsInclude' | 'optimizeDeps' | 'worker' | 'build'
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
          | 'plugins'
          | 'css'
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
        alias: import('dep-types/alias').Alias[]
      }
      plugins: readonly Plugin<any>[]
      css: import('./css').ResolvedCSSOptions
      esbuild: false | import('./esbuild').ESBuildOptions
      server: import('../server').ResolvedServerOptions
      build: import('../build').ResolvedBuildOptions
      preview: import('..').ResolvedPreviewOptions
      ssr: import('..').ResolvedSSROptions
      assetsInclude: (file: string) => boolean
      logger: Logger
      createResolver: (
        options?:
          | Partial<import('./resolve').InternalResolveOptions>
          | undefined,
      ) => import('../config').ResolveFn
      optimizeDeps: import('..').DepOptimizationOptions
      packageCache: import('../packages').PackageCache
      worker: import('../config').ResolvedWorkerOptions
      appType: import('../config').AppType
      experimental: import('../config').ExperimentalOptions
    } & import('../config').PluginHookUtils
  >,
  Map<string, boolean>
>
export declare function nodeIsElement(
  node: DefaultTreeAdapterMap['node'],
): node is DefaultTreeAdapterMap['element']
export declare function traverseHtml(
  html: string,
  filePath: string,
  visitor: (node: DefaultTreeAdapterMap['node']) => void,
): Promise<void>
export declare function getScriptInfo(node: DefaultTreeAdapterMap['element']): {
  src: Token.Attribute | undefined
  sourceCodeLocation: Token.Location | undefined
  isModule: boolean
  isAsync: boolean
}
export declare function overwriteAttrValue(
  s: MagicString,
  sourceCodeLocation: Token.Location,
  newValue: string,
): MagicString
/**
 * Compiles index.html into an entry js module
 */
export declare function buildHtmlPlugin(config: ResolvedConfig): Plugin
export declare function parseRelAttr(attr: string): string[]
export declare function findNeedTransformStyleAttribute(
  node: DefaultTreeAdapterMap['element'],
):
  | {
      attr: Token.Attribute
      location?: Token.Location
    }
  | undefined
export declare function extractImportExpressionFromClassicScript(
  scriptTextNode: DefaultTreeAdapterMap['textNode'],
): ScriptAssetsUrl[]
export interface HtmlTagDescriptor {
  tag: string
  attrs?: Record<string, string | boolean | undefined>
  children?: string | HtmlTagDescriptor[]
  /**
   * default: 'head-prepend'
   */
  injectTo?: 'head' | 'body' | 'head-prepend' | 'body-prepend'
}
export type IndexHtmlTransformResult =
  | string
  | HtmlTagDescriptor[]
  | {
      html: string
      tags: HtmlTagDescriptor[]
    }
export interface IndexHtmlTransformContext {
  /**
   * public path when served
   */
  path: string
  /**
   * filename on disk
   */
  filename: string
  server?: ViteDevServer
  bundle?: OutputBundle
  chunk?: OutputChunk
  originalUrl?: string
}
export type IndexHtmlTransformHook = (
  this: void,
  html: string,
  ctx: IndexHtmlTransformContext,
) => IndexHtmlTransformResult | void | Promise<IndexHtmlTransformResult | void>
export type IndexHtmlTransform =
  | IndexHtmlTransformHook
  | {
      order?: 'pre' | 'post' | null
      /**
       * @deprecated renamed to `order`
       */
      enforce?: 'pre' | 'post'
      /**
       * @deprecated renamed to `handler`
       */
      transform: IndexHtmlTransformHook
    }
  | {
      order?: 'pre' | 'post' | null
      /**
       * @deprecated renamed to `order`
       */
      enforce?: 'pre' | 'post'
      handler: IndexHtmlTransformHook
    }
export declare function preImportMapHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook
/**
 * Move importmap before the first module script and modulepreload link
 */
export declare function postImportMapHook(): IndexHtmlTransformHook
export declare function injectCspNonceMetaTagHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook
/**
 * Support `%ENV_NAME%` syntax in html files
 */
export declare function htmlEnvHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook
export declare function injectNonceAttributeTagHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook
export declare function resolveHtmlTransforms(
  plugins: readonly Plugin[],
  logger: Logger,
): [
  IndexHtmlTransformHook[],
  IndexHtmlTransformHook[],
  IndexHtmlTransformHook[],
]
export declare function applyHtmlTransforms(
  html: string,
  hooks: IndexHtmlTransformHook[],
  ctx: IndexHtmlTransformContext,
): Promise<string>
export declare function getAttrKey(attr: Token.Attribute): string
export {}
