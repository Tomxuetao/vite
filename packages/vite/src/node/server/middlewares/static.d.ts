import type { Connect } from 'dep-types/connect'
import type { ViteDevServer } from '../..'
export declare function servePublicMiddleware(
  server: ViteDevServer,
  publicFiles?: Set<string>,
): Connect.NextHandleFunction
export declare function serveStaticMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction
export declare function serveRawFsMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction
/**
 * Check if the url is allowed to be served, via the `server.fs` config.
 */
export declare function isFileServingAllowed(
  url: string,
  server: ViteDevServer,
): boolean
