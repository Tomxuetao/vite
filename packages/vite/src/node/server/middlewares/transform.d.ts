import type { Connect } from 'dep-types/connect'
import type { ViteDevServer } from '..'
/**
 * A middleware that short-circuits the middleware chain to serve cached transformed modules
 */
export declare function cachedTransformMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction
export declare function transformMiddleware(
  server: ViteDevServer,
): Connect.NextHandleFunction
