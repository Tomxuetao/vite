import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
export declare const dynamicImportHelperId = '\0vite/dynamic-import-helper.js'
export declare function transformDynamicImport(
  importSource: string,
  importer: string,
  resolve: (
    url: string,
    importer?: string,
  ) => Promise<string | undefined> | string | undefined,
  root: string,
): Promise<{
  glob: string
  pattern: string
  rawPattern: string
} | null>
export declare function dynamicImportVarsPlugin(config: ResolvedConfig): Plugin
