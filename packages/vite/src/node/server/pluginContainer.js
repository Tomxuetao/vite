/**
 * This file is refactored into TypeScript based on
 * https://github.com/preactjs/wmr/blob/main/packages/wmr/src/lib/rollup-plugin-container.js
 */
/**
https://github.com/preactjs/wmr/blob/master/LICENSE

MIT License

Copyright (c) 2020 The Preact Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import fs from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseAst as rollupParseAst } from 'rollup/parseAst'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import MagicString from 'magic-string'
import colors from 'picocolors'
import {
  combineSourcemaps,
  createDebugger,
  ensureWatchedFile,
  generateCodeFrame,
  isExternalUrl,
  isObject,
  normalizePath,
  numberToPos,
  prettifyUrl,
  rollupVersion,
  timeFrom,
} from '../utils'
import { FS_PREFIX } from '../constants'
import { createPluginHookUtils, getHookHandler } from '../plugins'
import { cleanUrl, unwrapId } from '../../shared/utils'
import { buildErrorMessage } from './middlewares/error'
const noop = () => {}
// same default value of "moduleInfo.meta" as in Rollup
const EMPTY_OBJECT = Object.freeze({})
const debugSourcemapCombineFilter =
  process.env.DEBUG_VITE_SOURCEMAP_COMBINE_FILTER
const debugSourcemapCombine = createDebugger('vite:sourcemap-combine', {
  onlyWhenFocused: true,
})
const debugResolve = createDebugger('vite:resolve')
const debugPluginResolve = createDebugger('vite:plugin-resolve', {
  onlyWhenFocused: 'vite:plugin',
})
const debugPluginTransform = createDebugger('vite:plugin-transform', {
  onlyWhenFocused: 'vite:plugin',
})
export const ERR_CLOSED_SERVER = 'ERR_CLOSED_SERVER'
export function throwClosedServerError() {
  const err = new Error(
    'The server is being restarted or closed. Request is outdated',
  )
  err.code = ERR_CLOSED_SERVER
  // This error will be caught by the transform middleware that will
  // send a 504 status code request timeout
  throw err
}
export async function createPluginContainer(config, moduleGraph, watcher) {
  const container = new PluginContainer(config, moduleGraph, watcher)
  await container.resolveRollupOptions()
  return container
}
class PluginContainer {
  config
  moduleGraph
  watcher
  plugins
  _pluginContextMap = new Map()
  _pluginContextMapSsr = new Map()
  _resolvedRollupOptions
  _processesing = new Set()
  _seenResolves = {}
  _closed = false
  // _addedFiles from the `load()` hook gets saved here so it can be reused in the `transform()` hook
  _moduleNodeToLoadAddedImports = new WeakMap()
  getSortedPluginHooks
  getSortedPlugins
  watchFiles = new Set()
  minimalContext
  /**
   * @internal use `createPluginContainer` instead
   */
  constructor(config, moduleGraph, watcher, plugins = config.plugins) {
    this.config = config
    this.moduleGraph = moduleGraph
    this.watcher = watcher
    this.plugins = plugins
    this.minimalContext = {
      meta: {
        rollupVersion,
        watchMode: true,
      },
      debug: noop,
      info: noop,
      warn: noop,
      // @ts-expect-error noop
      error: noop,
    }
    const utils = createPluginHookUtils(plugins)
    this.getSortedPlugins = utils.getSortedPlugins
    this.getSortedPluginHooks = utils.getSortedPluginHooks
  }
  _updateModuleLoadAddedImports(id, addedImports) {
    const module = this.moduleGraph?.getModuleById(id)
    if (module) {
      this._moduleNodeToLoadAddedImports.set(module, addedImports)
    }
  }
  _getAddedImports(id) {
    const module = this.moduleGraph?.getModuleById(id)
    return module
      ? this._moduleNodeToLoadAddedImports.get(module) || null
      : null
  }
  getModuleInfo(id) {
    const module = this.moduleGraph?.getModuleById(id)
    if (!module) {
      return null
    }
    if (!module.info) {
      module.info = new Proxy(
        { id, meta: module.meta || EMPTY_OBJECT },
        // throw when an unsupported ModuleInfo property is accessed,
        // so that incompatible plugins fail in a non-cryptic way.
        {
          get(info, key) {
            if (key in info) {
              return info[key]
            }
            // Don't throw an error when returning from an async function
            if (key === 'then') {
              return undefined
            }
            throw Error(
              `[vite] The "${key}" property of ModuleInfo is not supported.`,
            )
          },
        },
      )
    }
    return module.info ?? null
  }
  // keeps track of hook promises so that we can wait for them all to finish upon closing the server
  handleHookPromise(maybePromise) {
    if (!maybePromise?.then) {
      return maybePromise
    }
    const promise = maybePromise
    this._processesing.add(promise)
    return promise.finally(() => this._processesing.delete(promise))
  }
  get options() {
    return this._resolvedRollupOptions
  }
  async resolveRollupOptions() {
    if (!this._resolvedRollupOptions) {
      let options = this.config.build.rollupOptions
      for (const optionsHook of this.getSortedPluginHooks('options')) {
        if (this._closed) {
          throwClosedServerError()
        }
        options =
          (await this.handleHookPromise(
            optionsHook.call(this.minimalContext, options),
          )) || options
      }
      this._resolvedRollupOptions = options
    }
    return this._resolvedRollupOptions
  }
  _getPluginContext(plugin, ssr) {
    const map = ssr ? this._pluginContextMapSsr : this._pluginContextMap
    if (!map.has(plugin)) {
      const ctx = new PluginContext(plugin, this, ssr)
      map.set(plugin, ctx)
    }
    return map.get(plugin)
  }
  // parallel, ignores returns
  async hookParallel(hookName, context, args) {
    const parallelPromises = []
    for (const plugin of this.getSortedPlugins(hookName)) {
      // Don't throw here if closed, so buildEnd and closeBundle hooks can finish running
      const hook = plugin[hookName]
      if (!hook) continue
      const handler = getHookHandler(hook)
      if (hook.sequential) {
        await Promise.all(parallelPromises)
        parallelPromises.length = 0
        await handler.apply(context(plugin), args(plugin))
      } else {
        parallelPromises.push(handler.apply(context(plugin), args(plugin)))
      }
    }
    await Promise.all(parallelPromises)
  }
  async buildStart(_options) {
    await this.handleHookPromise(
      this.hookParallel(
        'buildStart',
        (plugin) => this._getPluginContext(plugin, false),
        () => [this.options],
      ),
    )
  }
  async resolveId(
    rawId,
    importer = join(this.config.root, 'index.html'),
    options,
  ) {
    const skip = options?.skip
    const ssr = options?.ssr
    const scan = !!options?.scan
    const ctx = new ResolveIdContext(this, !!ssr, skip, scan)
    const resolveStart = debugResolve ? performance.now() : 0
    let id = null
    const partial = {}
    for (const plugin of this.getSortedPlugins('resolveId')) {
      if (this._closed && !ssr) throwClosedServerError()
      if (!plugin.resolveId) continue
      if (skip?.has(plugin)) continue
      ctx._plugin = plugin
      const pluginResolveStart = debugPluginResolve ? performance.now() : 0
      const handler = getHookHandler(plugin.resolveId)
      const result = await this.handleHookPromise(
        handler.call(ctx, rawId, importer, {
          attributes: options?.attributes ?? {},
          custom: options?.custom,
          isEntry: !!options?.isEntry,
          ssr,
          scan,
        }),
      )
      if (!result) continue
      if (typeof result === 'string') {
        id = result
      } else {
        id = result.id
        Object.assign(partial, result)
      }
      debugPluginResolve?.(
        timeFrom(pluginResolveStart),
        plugin.name,
        prettifyUrl(id, this.config.root),
      )
      // resolveId() is hookFirst - first non-null result is returned.
      break
    }
    if (debugResolve && rawId !== id && !rawId.startsWith(FS_PREFIX)) {
      const key = rawId + id
      // avoid spamming
      if (!this._seenResolves[key]) {
        this._seenResolves[key] = true
        debugResolve(
          `${timeFrom(resolveStart)} ${colors.cyan(rawId)} -> ${colors.dim(id)}`,
        )
      }
    }
    if (id) {
      partial.id = isExternalUrl(id) ? id : normalizePath(id)
      return partial
    } else {
      return null
    }
  }
  async load(id, options) {
    const ssr = options?.ssr
    const ctx = new LoadPluginContext(this, !!ssr)
    for (const plugin of this.getSortedPlugins('load')) {
      if (this._closed && !ssr) throwClosedServerError()
      if (!plugin.load) continue
      ctx._plugin = plugin
      const handler = getHookHandler(plugin.load)
      const result = await this.handleHookPromise(
        handler.call(ctx, id, { ssr }),
      )
      if (result != null) {
        if (isObject(result)) {
          ctx._updateModuleInfo(id, result)
        }
        this._updateModuleLoadAddedImports(id, ctx._addedImports)
        return result
      }
    }
    this._updateModuleLoadAddedImports(id, ctx._addedImports)
    return null
  }
  async transform(code, id, options) {
    const inMap = options?.inMap
    const ssr = options?.ssr
    const ctx = new TransformPluginContext(this, id, code, inMap, !!ssr)
    ctx._addedImports = this._getAddedImports(id)
    for (const plugin of this.getSortedPlugins('transform')) {
      if (this._closed && !ssr) throwClosedServerError()
      if (!plugin.transform) continue
      ctx._updateActiveInfo(plugin, id, code)
      const start = debugPluginTransform ? performance.now() : 0
      let result
      const handler = getHookHandler(plugin.transform)
      try {
        result = await this.handleHookPromise(
          handler.call(ctx, code, id, { ssr }),
        )
      } catch (e) {
        ctx.error(e)
      }
      if (!result) continue
      debugPluginTransform?.(
        timeFrom(start),
        plugin.name,
        prettifyUrl(id, this.config.root),
      )
      if (isObject(result)) {
        if (result.code !== undefined) {
          code = result.code
          if (result.map) {
            if (debugSourcemapCombine) {
              // @ts-expect-error inject plugin name for debug purpose
              result.map.name = plugin.name
            }
            ctx.sourcemapChain.push(result.map)
          }
        }
        ctx._updateModuleInfo(id, result)
      } else {
        code = result
      }
    }
    return {
      code,
      map: ctx._getCombinedSourcemap(),
    }
  }
  async watchChange(id, change) {
    await this.hookParallel(
      'watchChange',
      (plugin) => this._getPluginContext(plugin, false),
      () => [id, change],
    )
  }
  async close() {
    if (this._closed) return
    this._closed = true
    await Promise.allSettled(Array.from(this._processesing))
    await this.hookParallel(
      'buildEnd',
      (plugin) => this._getPluginContext(plugin, false),
      () => [],
    )
    await this.hookParallel(
      'closeBundle',
      (plugin) => this._getPluginContext(plugin, false),
      () => [],
    )
  }
}
class PluginContext {
  _plugin
  _container
  ssr
  _scan = false
  _resolveSkips
  _activeId = null
  _activeCode = null
  meta
  constructor(_plugin, _container, ssr) {
    this._plugin = _plugin
    this._container = _container
    this.ssr = ssr
    this.meta = this._container.minimalContext.meta
  }
  parse(code, opts) {
    return rollupParseAst(code, opts)
  }
  getModuleInfo(id) {
    return this._container.getModuleInfo(id)
  }
  async resolve(id, importer, options) {
    let skip
    if (options?.skipSelf !== false && this._plugin) {
      skip = new Set(this._resolveSkips)
      skip.add(this._plugin)
    }
    let out = await this._container.resolveId(id, importer, {
      attributes: options?.attributes,
      custom: options?.custom,
      isEntry: !!options?.isEntry,
      skip,
      ssr: this.ssr,
      scan: this._scan,
    })
    if (typeof out === 'string') out = { id: out }
    return out
  }
  async load(options) {
    // We may not have added this to our module graph yet, so ensure it exists
    await this._container.moduleGraph?.ensureEntryFromUrl(
      unwrapId(options.id),
      this.ssr,
    )
    // Not all options passed to this function make sense in the context of loading individual files,
    // but we can at least update the module info properties we support
    this._updateModuleInfo(options.id, options)
    const loadResult = await this._container.load(options.id, {
      ssr: this.ssr,
    })
    const code = typeof loadResult === 'object' ? loadResult?.code : loadResult
    if (code != null) {
      await this._container.transform(code, options.id, { ssr: this.ssr })
    }
    const moduleInfo = this.getModuleInfo(options.id)
    // This shouldn't happen due to calling ensureEntryFromUrl, but 1) our types can't ensure that
    // and 2) moduleGraph may not have been provided (though in the situations where that happens,
    // we should never have plugins calling this.load)
    if (!moduleInfo) throw Error(`Failed to load module with id ${options.id}`)
    return moduleInfo
  }
  _updateModuleInfo(id, { meta }) {
    if (meta) {
      const moduleInfo = this.getModuleInfo(id)
      if (moduleInfo) {
        moduleInfo.meta = { ...moduleInfo.meta, ...meta }
      }
    }
  }
  getModuleIds() {
    return this._container.moduleGraph
      ? this._container.moduleGraph.idToModuleMap.keys()
      : Array.prototype[Symbol.iterator]()
  }
  addWatchFile(id) {
    this._container.watchFiles.add(id)
    if (this._container.watcher)
      ensureWatchedFile(
        this._container.watcher,
        id,
        this._container.config.root,
      )
  }
  getWatchFiles() {
    return [...this._container.watchFiles]
  }
  emitFile(assetOrFile) {
    this._warnIncompatibleMethod(`emitFile`)
    return ''
  }
  setAssetSource() {
    this._warnIncompatibleMethod(`setAssetSource`)
  }
  getFileName() {
    this._warnIncompatibleMethod(`getFileName`)
    return ''
  }
  warn(e, position) {
    const err = this._formatError(typeof e === 'function' ? e() : e, position)
    const msg = buildErrorMessage(
      err,
      [colors.yellow(`warning: ${err.message}`)],
      false,
    )
    this._container.config.logger.warn(msg, {
      clear: true,
      timestamp: true,
    })
  }
  error(e, position) {
    // error thrown here is caught by the transform middleware and passed on
    // the the error middleware.
    throw this._formatError(e, position)
  }
  debug = noop
  info = noop
  _formatError(e, position) {
    const err = typeof e === 'string' ? new Error(e) : e
    if (err.pluginCode) {
      return err // The plugin likely called `this.error`
    }
    if (this._plugin) err.plugin = this._plugin.name
    if (this._activeId && !err.id) err.id = this._activeId
    if (this._activeCode) {
      err.pluginCode = this._activeCode
      // some rollup plugins, e.g. json, sets err.position instead of err.pos
      const pos = position ?? err.pos ?? err.position
      if (pos != null) {
        let errLocation
        try {
          errLocation = numberToPos(this._activeCode, pos)
        } catch (err2) {
          this._container.config.logger.error(
            colors.red(
              `Error in error handler:\n${err2.stack || err2.message}\n`,
            ),
            // print extra newline to separate the two errors
            { error: err2 },
          )
          throw err
        }
        err.loc = err.loc || {
          file: err.id,
          ...errLocation,
        }
        err.frame = err.frame || generateCodeFrame(this._activeCode, pos)
      } else if (err.loc) {
        // css preprocessors may report errors in an included file
        if (!err.frame) {
          let code = this._activeCode
          if (err.loc.file) {
            err.id = normalizePath(err.loc.file)
            try {
              code = fs.readFileSync(err.loc.file, 'utf-8')
            } catch {}
          }
          err.frame = generateCodeFrame(code, err.loc)
        }
      } else if (err.line && err.column) {
        err.loc = {
          file: err.id,
          line: err.line,
          column: err.column,
        }
        err.frame = err.frame || generateCodeFrame(this._activeCode, err.loc)
      }
      // TODO: move it to overrides
      if (
        this instanceof TransformPluginContext &&
        typeof err.loc?.line === 'number' &&
        typeof err.loc?.column === 'number'
      ) {
        const rawSourceMap = this._getCombinedSourcemap()
        if (rawSourceMap && 'version' in rawSourceMap) {
          const traced = new TraceMap(rawSourceMap)
          const { source, line, column } = originalPositionFor(traced, {
            line: Number(err.loc.line),
            column: Number(err.loc.column),
          })
          if (source && line != null && column != null) {
            err.loc = { file: source, line, column }
          }
        }
      }
    } else if (err.loc) {
      if (!err.frame) {
        let code = err.pluginCode
        if (err.loc.file) {
          err.id = normalizePath(err.loc.file)
          if (!code) {
            try {
              code = fs.readFileSync(err.loc.file, 'utf-8')
            } catch {}
          }
        }
        if (code) {
          err.frame = generateCodeFrame(`${code}`, err.loc)
        }
      }
    }
    if (
      typeof err.loc?.column !== 'number' &&
      typeof err.loc?.line !== 'number' &&
      !err.loc?.file
    ) {
      delete err.loc
    }
    return err
  }
  _warnIncompatibleMethod(method) {
    this._container.config.logger.warn(
      colors.cyan(`[plugin:${this._plugin.name}] `) +
        colors.yellow(
          `context method ${colors.bold(`${method}()`)} is not supported in serve mode. This plugin is likely not vite-compatible.`,
        ),
    )
  }
}
class ResolveIdContext extends PluginContext {
  constructor(container, ssr, skip, scan) {
    super(null, container, ssr)
    this._resolveSkips = skip
    this._scan = scan
  }
}
class LoadPluginContext extends PluginContext {
  _addedImports = null
  constructor(container, ssr) {
    super(null, container, ssr)
  }
  addWatchFile(id) {
    if (!this._addedImports) {
      this._addedImports = new Set()
    }
    this._addedImports.add(id)
    super.addWatchFile(id)
  }
}
class TransformPluginContext extends LoadPluginContext {
  filename
  originalCode
  originalSourcemap = null
  sourcemapChain = []
  combinedMap = null
  constructor(container, id, code, inMap, ssr) {
    super(container, ssr)
    this.filename = id
    this.originalCode = code
    if (inMap) {
      if (debugSourcemapCombine) {
        // @ts-expect-error inject name for debug purpose
        inMap.name = '$inMap'
      }
      this.sourcemapChain.push(inMap)
    }
  }
  _getCombinedSourcemap() {
    if (
      debugSourcemapCombine &&
      debugSourcemapCombineFilter &&
      this.filename.includes(debugSourcemapCombineFilter)
    ) {
      debugSourcemapCombine('----------', this.filename)
      debugSourcemapCombine(this.combinedMap)
      debugSourcemapCombine(this.sourcemapChain)
      debugSourcemapCombine('----------')
    }
    let combinedMap = this.combinedMap
    // { mappings: '' }
    if (
      combinedMap &&
      !('version' in combinedMap) &&
      combinedMap.mappings === ''
    ) {
      this.sourcemapChain.length = 0
      return combinedMap
    }
    for (let m of this.sourcemapChain) {
      if (typeof m === 'string') m = JSON.parse(m)
      if (!('version' in m)) {
        // { mappings: '' }
        if (m.mappings === '') {
          combinedMap = { mappings: '' }
          break
        }
        // empty, nullified source map
        combinedMap = null
        break
      }
      if (!combinedMap) {
        const sm = m
        // sourcemap should not include `sources: [null]` (because `sources` should be string) nor
        // `sources: ['']` (because `''` means the path of sourcemap)
        // but MagicString generates this when `filename` option is not set.
        // Rollup supports these and therefore we support this as well
        if (sm.sources.length === 1 && !sm.sources[0]) {
          combinedMap = {
            ...sm,
            sources: [this.filename],
            sourcesContent: [this.originalCode],
          }
        } else {
          combinedMap = sm
        }
      } else {
        combinedMap = combineSourcemaps(cleanUrl(this.filename), [
          m,
          combinedMap,
        ])
      }
    }
    if (combinedMap !== this.combinedMap) {
      this.combinedMap = combinedMap
      this.sourcemapChain.length = 0
    }
    return this.combinedMap
  }
  getCombinedSourcemap() {
    const map = this._getCombinedSourcemap()
    if (!map || (!('version' in map) && map.mappings === '')) {
      return new MagicString(this.originalCode).generateMap({
        includeContent: true,
        hires: 'boundary',
        source: cleanUrl(this.filename),
      })
    }
    return map
  }
  _updateActiveInfo(plugin, id, code) {
    this._plugin = plugin
    this._activeId = id
    this._activeCode = code
  }
}
