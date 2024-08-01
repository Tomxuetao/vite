export declare const isWindows: boolean
/**
 * Prepend `/@id/` and replace null byte so the id is URL-safe.
 * This is prepended to resolved ids that are not valid browser
 * import specifiers by the importAnalysis plugin.
 */
export declare function wrapId(id: string): string
/**
 * Undo {@link wrapId}'s `/@id/` and null byte replacements.
 */
export declare function unwrapId(id: string): string
export declare function slash(p: string): string
export declare function cleanUrl(url: string): string
export declare function isPrimitive(value: unknown): boolean
export declare function withTrailingSlash(path: string): string
export declare const AsyncFunction: FunctionConstructor
export declare const asyncFunctionDeclarationPaddingLineCount: number
