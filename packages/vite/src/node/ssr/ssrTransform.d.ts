import type { SourceMap } from 'rollup'
import type { TransformResult } from '../server/transformRequest'
interface TransformOptions {
  json?: {
    stringify?: boolean
  }
}
export declare const ssrModuleExportsKey = '__vite_ssr_exports__'
export declare const ssrImportKey = '__vite_ssr_import__'
export declare const ssrDynamicImportKey = '__vite_ssr_dynamic_import__'
export declare const ssrExportAllKey = '__vite_ssr_exportAll__'
export declare const ssrImportMetaKey = '__vite_ssr_import_meta__'
export declare function ssrTransform(
  code: string,
  inMap:
    | SourceMap
    | {
        mappings: ''
      }
    | null,
  url: string,
  originalCode: string,
  options?: TransformOptions,
): Promise<TransformResult | null>
export {}
