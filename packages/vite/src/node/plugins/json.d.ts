/**
 * https://github.com/rollup/plugins/blob/master/packages/json/src/index.js
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file at
 * https://github.com/rollup/plugins/blob/master/LICENSE
 */
import type { Plugin } from '../plugin'
export interface JsonOptions {
  /**
   * Generate a named export for every property of the JSON object
   * @default true
   */
  namedExports?: boolean
  /**
   * Generate performant output as JSON.parse("stringified").
   * Enabling this will disable namedExports.
   * @default false
   */
  stringify?: boolean
}
export declare const isJSONRequest: (request: string) => boolean
export declare function jsonPlugin(
  options: JsonOptions | undefined,
  isBuild: boolean,
): Plugin
export declare function extractJsonErrorPosition(
  errorMessage: string,
  inputLength: number,
): number | undefined
