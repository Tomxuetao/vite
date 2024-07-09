import { EventEmitter } from 'node:events'
import path from 'node:path'
import glob from 'fast-glob'
import * as colors from 'picocolors'
import { withTrailingSlash } from '../shared/utils'
import { arraify, normalizePath } from './utils'
export function getResolvedOutDirs(root, outDir, outputOptions) {
  const resolvedOutDir = path.resolve(root, outDir)
  if (!outputOptions) return new Set([resolvedOutDir])
  return new Set(
    arraify(outputOptions).map(({ dir }) =>
      dir ? path.resolve(root, dir) : resolvedOutDir,
    ),
  )
}
export function resolveEmptyOutDir(emptyOutDir, root, outDirs, logger) {
  if (emptyOutDir != null) return emptyOutDir
  for (const outDir of outDirs) {
    if (!normalizePath(outDir).startsWith(withTrailingSlash(root))) {
      // warn if outDir is outside of root
      logger?.warn(
        colors.yellow(
          `\n${colors.bold(`(!)`)} outDir ${colors.white(colors.dim(outDir))} is not inside project root and will not be emptied.\n` +
            `Use --emptyOutDir to override.\n`,
        ),
      )
      return false
    }
  }
  return true
}
export function resolveChokidarOptions(
  config,
  options,
  resolvedOutDirs,
  emptyOutDir,
) {
  const { ignored: ignoredList, ...otherOptions } = options ?? {}
  const ignored = [
    '**/.git/**',
    '**/node_modules/**',
    '**/test-results/**',
    glob.escapePath(config.cacheDir) + '/**',
    ...arraify(ignoredList || []),
  ]
  if (emptyOutDir) {
    ignored.push(
      ...[...resolvedOutDirs].map((outDir) => glob.escapePath(outDir) + '/**'),
    )
  }
  const resolvedWatchOptions = {
    ignored,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ...otherOptions,
  }
  return resolvedWatchOptions
}
class NoopWatcher extends EventEmitter {
  options
  constructor(options) {
    super()
    this.options = options
  }
  add() {
    return this
  }
  unwatch() {
    return this
  }
  getWatched() {
    return {}
  }
  ref() {
    return this
  }
  unref() {
    return this
  }
  async close() {
    // noop
  }
}
export function createNoopWatcher(options) {
  return new NoopWatcher(options)
}
