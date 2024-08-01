import type { ResolvedConfig } from '..'
export declare function shouldExternalizeForSSR(
  id: string,
  importer: string | undefined,
  config: ResolvedConfig,
): boolean | undefined
export declare function createIsConfiguredAsSsrExternal(
  config: ResolvedConfig,
): (id: string, importer?: string) => boolean
