import type { ResolvedConfig } from '..'
export declare const importsRE: RegExp
export declare function scanImports(config: ResolvedConfig): {
  cancel: () => Promise<void>
  result: Promise<{
    deps: Record<string, string>
    missing: Record<string, string>
  }>
}
export declare const scriptRE: RegExp
export declare const commentRE: RegExp
