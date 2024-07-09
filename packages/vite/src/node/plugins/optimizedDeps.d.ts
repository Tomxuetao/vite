import type { ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
export declare const ERR_OPTIMIZE_DEPS_PROCESSING_ERROR =
  'ERR_OPTIMIZE_DEPS_PROCESSING_ERROR'
export declare const ERR_OUTDATED_OPTIMIZED_DEP = 'ERR_OUTDATED_OPTIMIZED_DEP'
export declare const ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR =
  'ERR_FILE_NOT_FOUND_IN_OPTIMIZED_DEP_DIR'
export declare function optimizedDepsPlugin(config: ResolvedConfig): Plugin
export declare function throwOutdatedRequest(id: string): never
export declare function throwFileNotFoundInOptimizedDep(id: string): never
