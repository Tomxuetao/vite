import type { OriginalMapping } from '@jridgewell/trace-mapping'
interface SourceMapLike {
  version: number
  mappings?: string
  names?: string[]
  sources?: string[]
  sourcesContent?: string[]
}
type Needle = {
  line: number
  column: number
}
export declare class DecodedMap {
  map: SourceMapLike
  _encoded: string
  _decoded: undefined | number[][][]
  _decodedMemo: Stats
  url: string
  version: number
  names: string[]
  resolvedSources: string[]
  constructor(map: SourceMapLike, from: string)
}
interface Stats {
  lastKey: number
  lastNeedle: number
  lastIndex: number
}
export declare function getOriginalPosition(
  map: DecodedMap,
  needle: Needle,
): OriginalMapping | null
export {}
