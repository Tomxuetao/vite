import type * as pathe from 'pathe'
export declare const decodeBase64: typeof atob
export declare const posixDirname: (path: string) => string
export declare const posixResolve: (...paths: string[]) => string
export declare const normalizeString: typeof pathe.normalizeString
export declare function posixPathToFileHref(posixPath: string): string
export declare function toWindowsPath(path: string): string
