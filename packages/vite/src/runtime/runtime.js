import { HMRClient, HMRContext } from '../shared/hmr'
import {
  cleanUrl,
  isPrimitive,
  isWindows,
  slash,
  unwrapId,
  wrapId,
} from '../shared/utils'
import { analyzeImportedModDifference } from '../shared/ssrTransform'
import { ModuleCacheMap } from './moduleCache'
import {
  posixDirname,
  posixPathToFileHref,
  posixResolve,
  toWindowsPath,
} from './utils'
import {
  ssrDynamicImportKey,
  ssrExportAllKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrModuleExportsKey,
} from './constants'
import { silentConsole } from './hmrLogger'
import { createHMRHandler } from './hmrHandler'
import { enableSourceMapSupport } from './sourcemap/index'
export class ViteRuntime {
  options
  runner
  debug
  /**
   * Holds the cache of modules
   * Keys of the map are ids
   */
  moduleCache
  hmrClient
  entrypoints = new Set()
  idToUrlMap = new Map()
  fileToIdMap = new Map()
  envProxy = new Proxy(
    {},
    {
      get(_, p) {
        throw new Error(
          `[vite-runtime] Dynamic access of "import.meta.env" is not supported. Please, use "import.meta.env.${String(p)}" instead.`,
        )
      },
    },
  )
  _destroyed = false
  _resetSourceMapSupport
  constructor(options, runner, debug) {
    this.options = options
    this.runner = runner
    this.debug = debug
    this.moduleCache = options.moduleCache ?? new ModuleCacheMap(options.root)
    if (typeof options.hmr === 'object') {
      this.hmrClient = new HMRClient(
        options.hmr.logger === false
          ? silentConsole
          : options.hmr.logger || console,
        options.hmr.connection,
        ({ acceptedPath, ssrInvalidates }) => {
          this.moduleCache.invalidate(acceptedPath)
          if (ssrInvalidates) {
            this.invalidateFiles(ssrInvalidates)
          }
          return this.executeUrl(acceptedPath)
        },
      )
      options.hmr.connection.onUpdate(createHMRHandler(this))
    }
    if (options.sourcemapInterceptor !== false) {
      this._resetSourceMapSupport = enableSourceMapSupport(this)
    }
  }
  /**
   * URL to execute. Accepts file path, server path or id relative to the root.
   */
  async executeUrl(url) {
    url = this.normalizeEntryUrl(url)
    const fetchedModule = await this.cachedModule(url)
    return await this.cachedRequest(url, fetchedModule)
  }
  /**
   * Entrypoint URL to execute. Accepts file path, server path or id relative to the root.
   * In the case of a full reload triggered by HMR, this is the module that will be reloaded.
   * If this method is called multiple times, all entrypoints will be reloaded one at a time.
   */
  async executeEntrypoint(url) {
    url = this.normalizeEntryUrl(url)
    const fetchedModule = await this.cachedModule(url)
    return await this.cachedRequest(url, fetchedModule, [], {
      entrypoint: true,
    })
  }
  /**
   * Clear all caches including HMR listeners.
   */
  clearCache() {
    this.moduleCache.clear()
    this.idToUrlMap.clear()
    this.entrypoints.clear()
    this.hmrClient?.clear()
  }
  /**
   * Clears all caches, removes all HMR listeners, and resets source map support.
   * This method doesn't stop the HMR connection.
   */
  async destroy() {
    this._resetSourceMapSupport?.()
    this.clearCache()
    this.hmrClient = undefined
    this._destroyed = true
  }
  /**
   * Returns `true` if the runtime has been destroyed by calling `destroy()` method.
   */
  isDestroyed() {
    return this._destroyed
  }
  invalidateFiles(files) {
    files.forEach((file) => {
      const ids = this.fileToIdMap.get(file)
      if (ids) {
        ids.forEach((id) => this.moduleCache.invalidate(id))
      }
    })
  }
  // we don't use moduleCache.normalize because this URL doesn't have to follow the same rules
  // this URL is something that user passes down manually, and is later resolved by fetchModule
  // moduleCache.normalize is used on resolved "file" property
  normalizeEntryUrl(url) {
    // expect fetchModule to resolve relative module correctly
    if (url[0] === '.') {
      return url
    }
    // file:///C:/root/id.js -> C:/root/id.js
    if (url.startsWith('file://')) {
      // 8 is the length of "file:///"
      url = url.slice(isWindows ? 8 : 7)
    }
    url = slash(url)
    const _root = this.options.root
    const root = _root[_root.length - 1] === '/' ? _root : `${_root}/`
    // strip root from the URL because fetchModule prefers a public served url path
    // packages/vite/src/node/server/moduleGraph.ts:17
    if (url.startsWith(root)) {
      // /root/id.js -> /id.js
      // C:/root/id.js -> /id.js
      // 1 is to keep the leading slash
      return url.slice(root.length - 1)
    }
    // if it's a server url (starts with a slash), keep it, otherwise assume a virtual module
    // /id.js -> /id.js
    // virtual:custom -> /@id/virtual:custom
    return url[0] === '/' ? url : wrapId(url)
  }
  processImport(exports, fetchResult, metadata) {
    if (!('externalize' in fetchResult)) {
      return exports
    }
    const { id, type } = fetchResult
    if (type !== 'module' && type !== 'commonjs') return exports
    analyzeImportedModDifference(exports, id, type, metadata)
    return exports
  }
  async cachedRequest(id, fetchedModule, callstack = [], metadata) {
    const moduleId = fetchedModule.id
    if (metadata?.entrypoint) {
      this.entrypoints.add(moduleId)
    }
    const mod = this.moduleCache.getByModuleId(moduleId)
    const { imports, importers } = mod
    const importee = callstack[callstack.length - 1]
    if (importee) importers.add(importee)
    // check circular dependency
    if (
      callstack.includes(moduleId) ||
      Array.from(imports.values()).some((i) => importers.has(i))
    ) {
      if (mod.exports)
        return this.processImport(mod.exports, fetchedModule, metadata)
    }
    let debugTimer
    if (this.debug) {
      debugTimer = setTimeout(() => {
        const getStack = () =>
          `stack:\n${[...callstack, moduleId]
            .reverse()
            .map((p) => `  - ${p}`)
            .join('\n')}`
        this.debug(
          `[vite-runtime] module ${moduleId} takes over 2s to load.\n${getStack()}`,
        )
      }, 2000)
    }
    try {
      // cached module
      if (mod.promise)
        return this.processImport(await mod.promise, fetchedModule, metadata)
      const promise = this.directRequest(id, fetchedModule, callstack)
      mod.promise = promise
      mod.evaluated = false
      return this.processImport(await promise, fetchedModule, metadata)
    } finally {
      mod.evaluated = true
      if (debugTimer) clearTimeout(debugTimer)
    }
  }
  async cachedModule(id, importer) {
    if (this._destroyed) {
      throw new Error(`[vite] Vite runtime has been destroyed.`)
    }
    const normalized = this.idToUrlMap.get(id)
    if (normalized) {
      const mod = this.moduleCache.getByModuleId(normalized)
      if (mod.meta) {
        return mod.meta
      }
    }
    this.debug?.('[vite-runtime] fetching', id)
    // fast return for established externalized patterns
    const fetchedModule = id.startsWith('data:')
      ? { externalize: id, type: 'builtin' }
      : await this.options.fetchModule(id, importer)
    // base moduleId on "file" and not on id
    // if `import(variable)` is called it's possible that it doesn't have an extension for example
    // if we used id for that, it's possible to have a duplicated module
    const idQuery = id.split('?')[1]
    const query = idQuery ? `?${idQuery}` : ''
    const file = 'file' in fetchedModule ? fetchedModule.file : undefined
    const fullFile = file ? `${file}${query}` : id
    const moduleId = this.moduleCache.normalize(fullFile)
    const mod = this.moduleCache.getByModuleId(moduleId)
    fetchedModule.id = moduleId
    mod.meta = fetchedModule
    if (file) {
      const fileModules = this.fileToIdMap.get(file) || []
      fileModules.push(moduleId)
      this.fileToIdMap.set(file, fileModules)
    }
    this.idToUrlMap.set(id, moduleId)
    this.idToUrlMap.set(unwrapId(id), moduleId)
    return fetchedModule
  }
  // override is allowed, consider this a public API
  async directRequest(id, fetchResult, _callstack) {
    const moduleId = fetchResult.id
    const callstack = [..._callstack, moduleId]
    const mod = this.moduleCache.getByModuleId(moduleId)
    const request = async (dep, metadata) => {
      const fetchedModule = await this.cachedModule(dep, moduleId)
      const depMod = this.moduleCache.getByModuleId(fetchedModule.id)
      depMod.importers.add(moduleId)
      mod.imports.add(fetchedModule.id)
      return this.cachedRequest(dep, fetchedModule, callstack, metadata)
    }
    const dynamicRequest = async (dep) => {
      // it's possible to provide an object with toString() method inside import()
      dep = String(dep)
      if (dep[0] === '.') {
        dep = posixResolve(posixDirname(id), dep)
      }
      return request(dep, { isDynamicImport: true })
    }
    if ('externalize' in fetchResult) {
      const { externalize } = fetchResult
      this.debug?.('[vite-runtime] externalizing', externalize)
      const exports = await this.runner.runExternalModule(externalize)
      mod.exports = exports
      return exports
    }
    const { code, file } = fetchResult
    if (code == null) {
      const importer = callstack[callstack.length - 2]
      throw new Error(
        `[vite-runtime] Failed to load "${id}"${importer ? ` imported from ${importer}` : ''}`,
      )
    }
    const modulePath = cleanUrl(file || moduleId)
    // disambiguate the `<UNIT>:/` on windows: see nodejs/node#31710
    const href = posixPathToFileHref(modulePath)
    const filename = modulePath
    const dirname = posixDirname(modulePath)
    const meta = {
      filename: isWindows ? toWindowsPath(filename) : filename,
      dirname: isWindows ? toWindowsPath(dirname) : dirname,
      url: href,
      env: this.envProxy,
      resolve(id, parent) {
        throw new Error(
          '[vite-runtime] "import.meta.resolve" is not supported.',
        )
      },
      // should be replaced during transformation
      glob() {
        throw new Error('[vite-runtime] "import.meta.glob" is not supported.')
      },
    }
    const exports = Object.create(null)
    Object.defineProperty(exports, Symbol.toStringTag, {
      value: 'Module',
      enumerable: false,
      configurable: false,
    })
    mod.exports = exports
    let hotContext
    if (this.hmrClient) {
      Object.defineProperty(meta, 'hot', {
        enumerable: true,
        get: () => {
          if (!this.hmrClient) {
            throw new Error(`[vite-runtime] HMR client was destroyed.`)
          }
          this.debug?.('[vite-runtime] creating hmr context for', moduleId)
          hotContext ||= new HMRContext(this.hmrClient, moduleId)
          return hotContext
        },
        set: (value) => {
          hotContext = value
        },
      })
    }
    const context = {
      [ssrImportKey]: request,
      [ssrDynamicImportKey]: dynamicRequest,
      [ssrModuleExportsKey]: exports,
      [ssrExportAllKey]: (obj) => exportAll(exports, obj),
      [ssrImportMetaKey]: meta,
    }
    this.debug?.('[vite-runtime] executing', href)
    await this.runner.runViteModule(context, code, id)
    return exports
  }
}
function exportAll(exports, sourceModule) {
  // when a module exports itself it causes
  // call stack error
  if (exports === sourceModule) return
  if (
    isPrimitive(sourceModule) ||
    Array.isArray(sourceModule) ||
    sourceModule instanceof Promise
  )
    return
  for (const key in sourceModule) {
    if (key !== 'default' && key !== '__esModule') {
      try {
        Object.defineProperty(exports, key, {
          enumerable: true,
          configurable: true,
          get: () => sourceModule[key],
        })
      } catch (_err) {}
    }
  }
}
