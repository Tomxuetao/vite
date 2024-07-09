import type { Connect } from 'dep-types/connect'
import type { FsUtils } from '../../fsUtils'
export declare function htmlFallbackMiddleware(
  root: string,
  spaFallback: boolean,
  fsUtils?: FsUtils,
): Connect.NextHandleFunction
