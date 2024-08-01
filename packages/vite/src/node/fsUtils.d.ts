import type { FSWatcher } from 'dep-types/chokidar'
import type { ResolvedConfig } from './config'
export interface FsUtils {
  existsSync: (path: string) => boolean
  isDirectory: (path: string) => boolean
  tryResolveRealFile: (
    path: string,
    preserveSymlinks?: boolean,
  ) => string | undefined
  tryResolveRealFileWithExtensions: (
    path: string,
    extensions: string[],
    preserveSymlinks?: boolean,
  ) => string | undefined
  tryResolveRealFileOrType: (
    path: string,
    preserveSymlinks?: boolean,
  ) =>
    | {
        path?: string
        type: 'directory' | 'file'
      }
    | undefined
  initWatcher?: (watcher: FSWatcher) => void
}
export declare const commonFsUtils: FsUtils
export declare function getFsUtils(config: ResolvedConfig): FsUtils
export declare function createCachedFsUtils(config: ResolvedConfig): FsUtils
