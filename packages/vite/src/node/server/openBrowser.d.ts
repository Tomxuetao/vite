/**
 * The following is modified based on source found in
 * https://github.com/facebook/create-react-app
 *
 * MIT Licensed
 * Copyright (c) 2015-present, Facebook, Inc.
 * https://github.com/facebook/create-react-app/blob/master/LICENSE
 *
 */
import type { Logger } from '../logger'
/**
 * Reads the BROWSER environment variable and decides what to do with it.
 */
export declare function openBrowser(
  url: string,
  opt: string | true,
  logger: Logger,
): void
