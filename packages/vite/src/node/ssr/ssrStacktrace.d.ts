import type { ModuleGraph } from '../server/moduleGraph'
export declare function ssrRewriteStacktrace(
  stack: string,
  moduleGraph: ModuleGraph,
): string
export declare function rebindErrorStacktrace(
  e: Error,
  stacktrace: string,
): void
export declare function ssrFixStacktrace(
  e: Error,
  moduleGraph: ModuleGraph,
): void
