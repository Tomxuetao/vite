import type { Connect } from 'dep-types/connect'
import type { PreviewServer, ResolvedConfig, ViteDevServer } from '../..'
export declare function createDevHtmlTransformFn(
  config: ResolvedConfig,
): (
  server: ViteDevServer,
  url: string,
  html: string,
  originalUrl?: string,
) => Promise<string>
export declare function indexHtmlMiddleware(
  root: string,
  server: ViteDevServer | PreviewServer,
): Connect.NextHandleFunction
