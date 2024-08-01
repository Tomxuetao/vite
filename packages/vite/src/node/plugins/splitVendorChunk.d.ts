import type { GetManualChunk } from 'rollup'
import type { Plugin } from '../plugin'
export declare const isCSSRequest: (request: string) => boolean
/**
 * @deprecated use build.rollupOptions.output.manualChunks or framework specific configuration
 */
export declare class SplitVendorChunkCache {
  cache: Map<string, boolean>
  constructor()
  reset(): void
}
/**
 * @deprecated use build.rollupOptions.output.manualChunks or framework specific configuration
 */
export declare function splitVendorChunk(options?: {
  cache?: SplitVendorChunkCache
}): GetManualChunk
/**
 * @deprecated use build.rollupOptions.output.manualChunks or framework specific configuration
 */
export declare function splitVendorChunkPlugin(): Plugin
