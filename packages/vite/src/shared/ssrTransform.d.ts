export interface DefineImportMetadata {
  /**
   * Imported names before being transformed to `ssrImportKey`
   *
   * import foo, { bar as baz, qux } from 'hello'
   * => ['default', 'bar', 'qux']
   *
   * import * as namespace from 'world
   * => undefined
   */
  importedNames?: string[]
}
export interface SSRImportBaseMetadata extends DefineImportMetadata {
  isDynamicImport?: boolean
}
/**
 * Vite converts `import { } from 'foo'` to `const _ = __vite_ssr_import__('foo')`.
 * Top-level imports and dynamic imports work slightly differently in Node.js.
 * This function normalizes the differences so it matches prod behaviour.
 */
export declare function analyzeImportedModDifference(
  mod: any,
  rawId: string,
  moduleType: string | undefined,
  metadata?: SSRImportBaseMetadata,
): void
