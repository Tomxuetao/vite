import type { ExistingRawSourceMap, SourceMap } from 'rollup'
import type { Logger } from '../logger'
interface SourceMapLike {
  sources: string[]
  sourcesContent?: (string | null)[]
  sourceRoot?: string
}
export declare function injectSourcesContent(
  map: SourceMapLike,
  file: string,
  logger: Logger,
): Promise<void>
export declare function genSourceMapUrl(map: SourceMap | string): string
export declare function getCodeWithSourcemap(
  type: 'js' | 'css',
  code: string,
  map: SourceMap,
): string
export declare function applySourcemapIgnoreList(
  map: ExistingRawSourceMap,
  sourcemapPath: string,
  sourcemapIgnoreList: (sourcePath: string, sourcemapPath: string) => boolean,
  logger?: Logger,
): void
export declare function extractSourcemapFromFile(
  code: string,
  filePath: string,
): Promise<
  | {
      code: string
      map: SourceMap
    }
  | undefined
>
export {}
