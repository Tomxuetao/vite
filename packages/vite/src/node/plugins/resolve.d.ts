import type { PartialResolvedId } from 'rollup'
import type { Plugin } from '../plugin'
import type { DepsOptimizer } from '../optimizer'
import type { SSROptions } from '..'
import type { PackageCache, PackageData } from '../packages'
import type { FsUtils } from '../fsUtils'
export declare const browserExternalId = '__vite-browser-external'
export declare const optionalPeerDepId = '__vite-optional-peer-dep'
export interface ResolveOptions {
  /**
   * @default ['browser', 'module', 'jsnext:main', 'jsnext']
   */
  mainFields?: string[]
  conditions?: string[]
  /**
   * @default ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']
   */
  extensions?: string[]
  dedupe?: string[]
  /**
   * @default false
   */
  preserveSymlinks?: boolean
}
export interface InternalResolveOptions extends Required<ResolveOptions> {
  root: string
  isBuild: boolean
  isProduction: boolean
  ssrConfig?: SSROptions
  packageCache?: PackageCache
  fsUtils?: FsUtils
  /**
   * src code mode also attempts the following:
   * - resolving /xxx as URLs
   * - resolving bare imports from optimized deps
   */
  asSrc?: boolean
  tryIndex?: boolean
  tryPrefix?: string
  preferRelative?: boolean
  isRequire?: boolean
  isFromTsImporter?: boolean
  tryEsmOnly?: boolean
  scan?: boolean
  ssrOptimizeCheck?: boolean
  getDepsOptimizer?: (ssr: boolean) => DepsOptimizer | undefined
  shouldExternalize?: (id: string, importer?: string) => boolean | undefined
}
export declare function resolvePlugin(
  resolveOptions: InternalResolveOptions,
): Plugin
export declare function tryFsResolve(
  fsPath: string,
  options: InternalResolveOptions,
  tryIndex?: boolean,
  targetWeb?: boolean,
  skipPackageJson?: boolean,
): string | undefined
export type InternalResolveOptionsWithOverrideConditions =
  InternalResolveOptions & {}
export declare function tryNodeResolve(
  id: string,
  importer: string | null | undefined,
  options: InternalResolveOptionsWithOverrideConditions,
  targetWeb: boolean,
  depsOptimizer?: DepsOptimizer,
  ssr?: boolean,
  externalize?: boolean,
  allowLinkedExternal?: boolean,
): PartialResolvedId | undefined
export declare function tryOptimizedResolve(
  depsOptimizer: DepsOptimizer,
  id: string,
  importer?: string,
  preserveSymlinks?: boolean,
  packageCache?: PackageCache,
): Promise<string | undefined>
export declare function resolvePackageEntry(
  id: string,
  { dir, data, setResolvedCache, getResolvedCache }: PackageData,
  targetWeb: boolean,
  options: InternalResolveOptions,
): string | undefined
