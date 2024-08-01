/// <reference types="node" />
import type * as http from 'node:http'
import type { Connect } from 'dep-types/connect'
import type { HttpProxy } from 'dep-types/http-proxy'
import type { CommonServerOptions, ResolvedConfig } from '../..'
import type { HttpServer } from '..'
export interface ProxyOptions extends HttpProxy.ServerOptions {
  /**
   * rewrite path
   */
  rewrite?: (path: string) => string
  /**
   * configure the proxy server (e.g. listen to events)
   */
  configure?: (proxy: HttpProxy.Server, options: ProxyOptions) => void
  /**
   * webpack-dev-server style bypass function
   */
  bypass?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    options: ProxyOptions,
  ) => void | null | undefined | false | string
  /**
   * rewrite the Origin header of a WebSocket request to match the the target
   *
   * **Exercise caution as rewriting the Origin can leave the proxying open to [CSRF attacks](https://owasp.org/www-community/attacks/csrf).**
   */
  rewriteWsOrigin?: boolean | undefined
}
export declare function proxyMiddleware(
  httpServer: HttpServer | null,
  options: NonNullable<CommonServerOptions['proxy']>,
  config: ResolvedConfig,
): Connect.NextHandleFunction
