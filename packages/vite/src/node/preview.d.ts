import type { Connect } from 'dep-types/connect'
import type {
  HttpServer,
  ResolvedServerOptions,
  ResolvedServerUrls,
} from './server'
import type { CommonServerOptions } from './http'
import type { BindCLIShortcutsOptions } from './shortcuts'
import type { InlineConfig, ResolvedConfig } from './config'
export interface PreviewOptions extends CommonServerOptions {}
export interface ResolvedPreviewOptions extends PreviewOptions {}
export declare function resolvePreviewOptions(
  preview: PreviewOptions | undefined,
  server: ResolvedServerOptions,
): ResolvedPreviewOptions
export interface PreviewServer {
  /**
   * The resolved vite config object
   */
  config: ResolvedConfig
  /**
   * Stop the server.
   */
  close(): Promise<void>
  /**
   * A connect app instance.
   * - Can be used to attach custom middlewares to the preview server.
   * - Can also be used as the handler function of a custom http server
   *   or as a middleware in any connect-style Node.js frameworks
   *
   * https://github.com/senchalabs/connect#use-middleware
   */
  middlewares: Connect.Server
  /**
   * native Node http server instance
   */
  httpServer: HttpServer
  /**
   * The resolved urls Vite prints on the CLI.
   * null before server is listening.
   */
  resolvedUrls: ResolvedServerUrls | null
  /**
   * Print server urls
   */
  printUrls(): void
  /**
   * Bind CLI shortcuts
   */
  bindCLIShortcuts(options?: BindCLIShortcutsOptions<PreviewServer>): void
}
export type PreviewServerHook = (
  this: void,
  server: PreviewServer,
) => (() => void) | void | Promise<(() => void) | void>
/**
 * Starts the Vite server in preview mode, to simulate a production deployment
 */
export declare function preview(
  inlineConfig?: InlineConfig,
): Promise<PreviewServer>
