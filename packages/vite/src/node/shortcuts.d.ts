import type { ViteDevServer } from './server'
import type { PreviewServer } from './preview'
export type BindCLIShortcutsOptions<Server = ViteDevServer | PreviewServer> = {
  /**
   * Print a one-line shortcuts "help" hint to the terminal
   */
  print?: boolean
  /**
   * Custom shortcuts to run when a key is pressed. These shortcuts take priority
   * over the default shortcuts if they have the same keys (except the `h` key).
   * To disable a default shortcut, define the same key but with `action: undefined`.
   */
  customShortcuts?: CLIShortcut<Server>[]
}
export type CLIShortcut<Server = ViteDevServer | PreviewServer> = {
  key: string
  description: string
  action?(server: Server): void | Promise<void>
}
export declare function bindCLIShortcuts<
  Server extends ViteDevServer | PreviewServer,
>(server: Server, opts?: BindCLIShortcutsOptions<Server>): void
