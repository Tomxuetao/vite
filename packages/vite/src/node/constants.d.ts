export declare const VERSION: string
export declare const DEFAULT_MAIN_FIELDS: string[]
export declare const ESBUILD_MODULES_TARGET: string[]
export declare const DEFAULT_EXTENSIONS: string[]
export declare const DEFAULT_CONFIG_FILES: string[]
export declare const JS_TYPES_RE: RegExp
export declare const CSS_LANGS_RE: RegExp
export declare const OPTIMIZABLE_ENTRY_RE: RegExp
export declare const SPECIAL_QUERY_RE: RegExp
/**
 * Prefix for resolved fs paths, since windows paths may not be valid as URLs.
 */
export declare const FS_PREFIX = '/@fs/'
export declare const CLIENT_PUBLIC_PATH = '/@vite/client'
export declare const ENV_PUBLIC_PATH = '/@vite/env'
export declare const VITE_PACKAGE_DIR: string
export declare const CLIENT_ENTRY: string
export declare const ENV_ENTRY: string
export declare const CLIENT_DIR: string
export declare const KNOWN_ASSET_TYPES: string[]
export declare const DEFAULT_ASSETS_RE: RegExp
export declare const DEP_VERSION_RE: RegExp
export declare const loopbackHosts: Set<string>
export declare const wildcardHosts: Set<string>
export declare const DEFAULT_DEV_PORT = 5173
export declare const DEFAULT_PREVIEW_PORT = 4173
export declare const DEFAULT_ASSETS_INLINE_LIMIT = 4096
export declare const METADATA_FILENAME = '_metadata.json'
