import { originalPositionFor } from '@jridgewell/trace-mapping'
import { posixResolve } from '../utils'
export class DecodedMap {
  map
  _encoded
  _decoded
  _decodedMemo
  url
  version
  names = []
  resolvedSources
  constructor(map, from) {
    this.map = map
    const { mappings, names, sources } = map
    this.version = map.version
    this.names = names || []
    this._encoded = mappings || ''
    this._decodedMemo = memoizedState()
    this.url = from
    this.resolvedSources = (sources || []).map((s) =>
      posixResolve(s || '', from),
    )
  }
}
function memoizedState() {
  return {
    lastKey: -1,
    lastNeedle: -1,
    lastIndex: -1,
  }
}
export function getOriginalPosition(map, needle) {
  const result = originalPositionFor(map, needle)
  if (result.column == null) {
    return null
  }
  return result
}
