import type { TransformOptions, TransformResult } from 'esbuild'
import type { InternalModuleFormat, SourceMap } from 'rollup'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
export declare const defaultEsbuildSupported: {
  'dynamic-import': boolean
  'import-meta': boolean
}
export interface ESBuildOptions extends TransformOptions {
  include?: string | RegExp | string[] | RegExp[]
  exclude?: string | RegExp | string[] | RegExp[]
  jsxInject?: string
  /**
   * This option is not respected. Use `build.minify` instead.
   */
  minify?: never
}
export type ESBuildTransformResult = Omit<TransformResult, 'map'> & {
  map: SourceMap
}
type TSConfigJSON = {
  extends?: string
  compilerOptions?: {
    alwaysStrict?: boolean
    experimentalDecorators?: boolean
    importsNotUsedAsValues?: 'remove' | 'preserve' | 'error'
    jsx?: 'preserve' | 'react' | 'react-jsx' | 'react-jsxdev'
    jsxFactory?: string
    jsxFragmentFactory?: string
    jsxImportSource?: string
    preserveValueImports?: boolean
    target?: string
    useDefineForClassFields?: boolean
    verbatimModuleSyntax?: boolean
  }
  [key: string]: any
}
export declare function transformWithEsbuild(
  code: string,
  filename: string,
  options?: TransformOptions,
  inMap?: object,
): Promise<ESBuildTransformResult>
export declare function esbuildPlugin(config: ResolvedConfig): Plugin
export declare const buildEsbuildPlugin: (config: ResolvedConfig) => Plugin
export declare function resolveEsbuildTranspileOptions(
  config: ResolvedConfig,
  format: InternalModuleFormat,
): TransformOptions | null
export declare function loadTsconfigJsonForFile(
  filename: string,
): Promise<TSConfigJSON>
export {}
