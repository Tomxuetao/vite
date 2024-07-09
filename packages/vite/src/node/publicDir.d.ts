import type { ResolvedConfig } from './config'
export declare function initPublicFiles(
  config: ResolvedConfig,
): Promise<Set<string> | undefined>
export declare function checkPublicFile(
  url: string,
  config: ResolvedConfig,
): string | undefined
