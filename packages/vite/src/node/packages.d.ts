import type { Plugin } from './plugin'
/** Cache for package.json resolution and package.json contents */
export type PackageCache = Map<string, PackageData>
export interface PackageData {
  dir: string
  hasSideEffects: (id: string) => boolean | 'no-treeshake' | null
  webResolvedImports: Record<string, string | undefined>
  nodeResolvedImports: Record<string, string | undefined>
  setResolvedCache: (key: string, entry: string, targetWeb: boolean) => void
  getResolvedCache: (key: string, targetWeb: boolean) => string | undefined
  data: {
    [field: string]: any
    name: string
    type: string
    version: string
    main: string
    module: string
    browser: string | Record<string, string | false>
    exports: string | Record<string, any> | string[]
    imports: Record<string, any>
    dependencies: Record<string, string>
  }
}
export declare function resolvePackageData(
  pkgName: string,
  basedir: string,
  preserveSymlinks?: boolean,
  packageCache?: PackageCache,
): PackageData | null
export declare function findNearestPackageData(
  basedir: string,
  packageCache?: PackageCache,
): PackageData | null
export declare function findNearestMainPackageData(
  basedir: string,
  packageCache?: PackageCache,
): PackageData | null
export declare function loadPackageData(pkgPath: string): PackageData
export declare function watchPackageDataPlugin(
  packageCache: PackageCache,
): Plugin
