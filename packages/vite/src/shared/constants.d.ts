/**
 * Prefix for resolved Ids that are not valid browser import specifiers
 */
export declare const VALID_ID_PREFIX = '/@id/'
/**
 * Plugins that use 'virtual modules' (e.g. for helper functions), prefix the
 * module ID with `\0`, a convention from the rollup ecosystem.
 * This prevents other plugins from trying to process the id (like node resolution),
 * and core features like sourcemaps can use this info to differentiate between
 * virtual modules and regular files.
 * `\0` is not a permitted char in import URLs so we have to replace them during
 * import analysis. The id will be decoded back before entering the plugins pipeline.
 * These encoded virtual ids are also prefixed by the VALID_ID_PREFIX, so virtual
 * modules in the browser end up encoded as `/@id/__x00__{id}`
 */
export declare const NULL_BYTE_PLACEHOLDER = '__x00__'
export declare let SOURCEMAPPING_URL: string
export declare const VITE_RUNTIME_SOURCEMAPPING_SOURCE =
  '//# sourceMappingSource=vite-runtime'
