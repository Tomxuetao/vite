import type { FSWatcher, WatchOptions } from 'dep-types/chokidar'
import type { OutputOptions } from 'rollup'
import type { ResolvedConfig } from './config'
import type { Logger } from './logger'
export declare function getResolvedOutDirs(
  root: string,
  outDir: string,
  outputOptions: OutputOptions[] | OutputOptions | undefined,
): Set<string>
export declare function resolveEmptyOutDir(
  emptyOutDir: boolean | null,
  root: string,
  outDirs: Set<string>,
  logger?: Logger,
): boolean
export declare function resolveChokidarOptions(
  config: ResolvedConfig,
  options: WatchOptions | undefined,
  resolvedOutDirs: Set<string>,
  emptyOutDir: boolean,
): WatchOptions
export declare function createNoopWatcher(options: WatchOptions): FSWatcher
