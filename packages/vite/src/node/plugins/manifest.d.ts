import type { InternalModuleFormat, OutputChunk, RenderedChunk } from 'rollup'
import type { ResolvedConfig } from '..'
import type { Plugin } from '../plugin'
export type Manifest = Record<string, ManifestChunk>
export interface ManifestChunk {
  src?: string
  file: string
  css?: string[]
  assets?: string[]
  isEntry?: boolean
  name?: string
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
}
export declare function manifestPlugin(config: ResolvedConfig): Plugin
export declare function getChunkOriginalFileName(
  chunk: OutputChunk | RenderedChunk,
  root: string,
  format: InternalModuleFormat,
): string
