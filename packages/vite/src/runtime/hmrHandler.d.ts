import type { HMRPayload } from 'types/hmrPayload'
import type { ViteRuntime } from './runtime'
export declare function createHMRHandler(
  runtime: ViteRuntime,
): (payload: HMRPayload) => Promise<void>
export declare function handleHMRPayload(
  runtime: ViteRuntime,
  payload: HMRPayload,
): Promise<void>
