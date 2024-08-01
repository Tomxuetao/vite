import type { DecodedMap } from './sourcemap/decoder'
import type { ModuleCache } from './types'
export declare class ModuleCacheMap extends Map<string, ModuleCache> {
  private root
  constructor(root: string, entries?: [string, ModuleCache][])
  normalize(fsPath: string): string
  /**
   * Assign partial data to the map
   */
  update(fsPath: string, mod: ModuleCache): this
  setByModuleId(modulePath: string, mod: ModuleCache): this
  set(fsPath: string, mod: ModuleCache): this
  getByModuleId(modulePath: string): ModuleCache
  get(fsPath: string): ModuleCache
  deleteByModuleId(modulePath: string): boolean
  delete(fsPath: string): boolean
  invalidate(id: string): void
  isImported(
    {
      importedId,
      importedBy,
    }: {
      importedId: string
      importedBy: string
    },
    seen?: Set<string>,
  ): boolean
  /**
   * Invalidate modules that dependent on the given modules, up to the main entry
   */
  invalidateDepTree(
    ids: string[] | Set<string>,
    invalidated?: Set<string>,
  ): Set<string>
  /**
   * Invalidate dependency modules of the given modules, down to the bottom-level dependencies
   */
  invalidateSubDepTree(
    ids: string[] | Set<string>,
    invalidated?: Set<string>,
  ): Set<string>
  getSourceMap(moduleId: string): null | DecodedMap
}
