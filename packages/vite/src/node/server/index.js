import path from 'node:path'
import { execSync } from 'node:child_process'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { performance } from 'node:perf_hooks'
import connect from 'connect'
import corsMiddleware from 'cors'
import colors from 'picocolors'
import chokidar from 'chokidar'
import launchEditorMiddleware from 'launch-editor-middleware'
import picomatch from 'picomatch'
import {
  httpServerStart,
  resolveHttpServer,
  resolveHttpsConfig,
  setClientErrorHandler,
} from '../http'
import { isDepsOptimizerEnabled, resolveConfig } from '../config'
import {
  diffDnsOrderChange,
  isInNodeModules,
  isObject,
  isParentDirectory,
  mergeConfig,
  normalizePath,
  promiseWithResolvers,
  resolveHostname,
  resolveServerUrls,
  setupSIGTERMListener,
  teardownSIGTERMListener,
} from '../utils'
import { getFsUtils } from '../fsUtils'
import { ssrLoadModule } from '../ssr/ssrModuleLoader'
import { ssrFixStacktrace, ssrRewriteStacktrace } from '../ssr/ssrStacktrace'
import { ssrTransform } from '../ssr/ssrTransform'
import { ERR_OUTDATED_OPTIMIZED_DEP } from '../plugins/optimizedDeps'
import { getDepsOptimizer, initDepsOptimizer } from '../optimizer'
import { bindCLIShortcuts } from '../shortcuts'
import { CLIENT_DIR, DEFAULT_DEV_PORT } from '../constants'
import { printServerUrls } from '../logger'
import {
  createNoopWatcher,
  getResolvedOutDirs,
  resolveChokidarOptions,
  resolveEmptyOutDir,
} from '../watch'
import { initPublicFiles } from '../publicDir'
import { getEnvFilesForMode } from '../env'
import { ssrFetchModule } from '../ssr/ssrFetchModule'
import { ERR_CLOSED_SERVER, createPluginContainer } from './pluginContainer'
import { createWebSocketServer } from './ws'
import { baseMiddleware } from './middlewares/base'
import { proxyMiddleware } from './middlewares/proxy'
import { htmlFallbackMiddleware } from './middlewares/htmlFallback'
import {
  cachedTransformMiddleware,
  transformMiddleware,
} from './middlewares/transform'
import {
  createDevHtmlTransformFn,
  indexHtmlMiddleware,
} from './middlewares/indexHtml'
import {
  servePublicMiddleware,
  serveRawFsMiddleware,
  serveStaticMiddleware,
} from './middlewares/static'
import { timeMiddleware } from './middlewares/time'
import { ModuleGraph } from './moduleGraph'
import { notFoundMiddleware } from './middlewares/notFound'
import { errorMiddleware, prepareError } from './middlewares/error'
import {
  createHMRBroadcaster,
  createServerHMRChannel,
  getShortName,
  handleHMRUpdate,
  updateModules,
} from './hmr'
import { openBrowser as _openBrowser } from './openBrowser'
import { transformRequest } from './transformRequest'
import { searchForWorkspaceRoot } from './searchRoot'
import { warmupFiles } from './warmup'
export function createServer(inlineConfig = {}) {
  return _createServer(inlineConfig, { hotListen: true })
}
export async function _createServer(inlineConfig = {}, options) {
  const config = await resolveConfig(inlineConfig, 'serve')
  const initPublicFilesPromise = initPublicFiles(config)
  const { root, server: serverConfig } = config
  const httpsOptions = await resolveHttpsConfig(config.server.https)
  const { middlewareMode } = serverConfig
  const resolvedOutDirs = getResolvedOutDirs(
    config.root,
    config.build.outDir,
    config.build.rollupOptions?.output,
  )
  const emptyOutDir = resolveEmptyOutDir(
    config.build.emptyOutDir,
    config.root,
    resolvedOutDirs,
  )
  const resolvedWatchOptions = resolveChokidarOptions(
    config,
    {
      disableGlobbing: true,
      ...serverConfig.watch,
    },
    resolvedOutDirs,
    emptyOutDir,
  )
  const middlewares = connect()
  const httpServer = middlewareMode
    ? null
    : await resolveHttpServer(serverConfig, middlewares, httpsOptions)
  const ws = createWebSocketServer(httpServer, config, httpsOptions)
  const hot = createHMRBroadcaster()
    .addChannel(ws)
    .addChannel(createServerHMRChannel())
  if (typeof config.server.hmr === 'object' && config.server.hmr.channels) {
    config.server.hmr.channels.forEach((channel) => hot.addChannel(channel))
  }
  const publicFiles = await initPublicFilesPromise
  const { publicDir } = config
  if (httpServer) {
    setClientErrorHandler(httpServer, config.logger)
  }
  // eslint-disable-next-line eqeqeq
  const watchEnabled = serverConfig.watch !== null
  const watcher = watchEnabled
    ? chokidar.watch(
        // config file dependencies and env file might be outside of root
        [
          root,
          ...config.configFileDependencies,
          ...getEnvFilesForMode(config.mode, config.envDir),
          // Watch the public directory explicitly because it might be outside
          // of the root directory.
          ...(publicDir && publicFiles ? [publicDir] : []),
        ],
        resolvedWatchOptions,
      )
    : createNoopWatcher(resolvedWatchOptions)
  const moduleGraph = new ModuleGraph((url, ssr) =>
    container.resolveId(url, undefined, { ssr }),
  )
  const container = await createPluginContainer(config, moduleGraph, watcher)
  const closeHttpServer = createServerCloseFn(httpServer)
  const devHtmlTransformFn = createDevHtmlTransformFn(config)
  const onCrawlEndCallbacks = []
  const crawlEndFinder = setupOnCrawlEnd(() => {
    onCrawlEndCallbacks.forEach((cb) => cb())
  })
  function waitForRequestsIdle(ignoredId) {
    return crawlEndFinder.waitForRequestsIdle(ignoredId)
  }
  function _registerRequestProcessing(id, done) {
    crawlEndFinder.registerRequestProcessing(id, done)
  }
  function _onCrawlEnd(cb) {
    onCrawlEndCallbacks.push(cb)
  }
  let server = {
    config,
    middlewares,
    httpServer,
    watcher,
    pluginContainer: container,
    ws,
    hot,
    moduleGraph,
    resolvedUrls: null,
    ssrTransform(code, inMap, url, originalCode = code) {
      return ssrTransform(code, inMap, url, originalCode, server.config)
    },
    transformRequest(url, options) {
      return transformRequest(url, server, options)
    },
    async warmupRequest(url, options) {
      try {
        await transformRequest(url, server, options)
      } catch (e) {
        if (
          e?.code === ERR_OUTDATED_OPTIMIZED_DEP ||
          e?.code === ERR_CLOSED_SERVER
        ) {
          // these are expected errors
          return
        }
        // Unexpected error, log the issue but avoid an unhandled exception
        server.config.logger.error(`Pre-transform error: ${e.message}`, {
          error: e,
          timestamp: true,
        })
      }
    },
    transformIndexHtml(url, html, originalUrl) {
      return devHtmlTransformFn(server, url, html, originalUrl)
    },
    async ssrLoadModule(url, opts) {
      return ssrLoadModule(url, server, undefined, opts?.fixStacktrace)
    },
    async ssrFetchModule(url, importer) {
      return ssrFetchModule(server, url, importer)
    },
    ssrFixStacktrace(e) {
      ssrFixStacktrace(e, moduleGraph)
    },
    ssrRewriteStacktrace(stack) {
      return ssrRewriteStacktrace(stack, moduleGraph)
    },
    async reloadModule(module) {
      if (serverConfig.hmr !== false && module.file) {
        updateModules(module.file, [module], Date.now(), server)
      }
    },
    async listen(port, isRestart) {
      await startServer(server, port)
      if (httpServer) {
        server.resolvedUrls = await resolveServerUrls(
          httpServer,
          config.server,
          config,
        )
        if (!isRestart && config.server.open) server.openBrowser()
      }
      return server
    },
    openBrowser() {
      const options = server.config.server
      const url =
        server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0]
      if (url) {
        const path =
          typeof options.open === 'string'
            ? new URL(options.open, url).href
            : url
        // We know the url that the browser would be opened to, so we can
        // start the request while we are awaiting the browser. This will
        // start the crawling of static imports ~500ms before.
        // preTransformRequests needs to be enabled for this optimization.
        if (server.config.server.preTransformRequests) {
          setTimeout(() => {
            const getMethod = path.startsWith('https:') ? httpsGet : httpGet
            getMethod(
              path,
              {
                headers: {
                  // Allow the history middleware to redirect to /index.html
                  Accept: 'text/html',
                },
              },
              (res) => {
                res.on('end', () => {
                  // Ignore response, scripts discovered while processing the entry
                  // will be preprocessed (server.config.server.preTransformRequests)
                })
              },
            )
              .on('error', () => {
                // Ignore errors
              })
              .end()
          }, 0)
        }
        _openBrowser(path, true, server.config.logger)
      } else {
        server.config.logger.warn('No URL available to open in browser')
      }
    },
    async close() {
      if (!middlewareMode) {
        teardownSIGTERMListener(closeServerAndExit)
      }
      await Promise.allSettled([
        watcher.close(),
        hot.close(),
        container.close(),
        crawlEndFinder?.cancel(),
        getDepsOptimizer(server.config)?.close(),
        getDepsOptimizer(server.config, true)?.close(),
        closeHttpServer(),
      ])
      // Await pending requests. We throw early in transformRequest
      // and in hooks if the server is closing for non-ssr requests,
      // so the import analysis plugin stops pre-transforming static
      // imports and this block is resolved sooner.
      // During SSR, we let pending requests finish to avoid exposing
      // the server closed error to the users.
      while (server._pendingRequests.size > 0) {
        await Promise.allSettled(
          [...server._pendingRequests.values()].map(
            (pending) => pending.request,
          ),
        )
      }
      server.resolvedUrls = null
    },
    printUrls() {
      if (server.resolvedUrls) {
        printServerUrls(
          server.resolvedUrls,
          serverConfig.host,
          config.logger.info,
        )
      } else if (middlewareMode) {
        throw new Error('cannot print server URLs in middleware mode.')
      } else {
        throw new Error(
          'cannot print server URLs before server.listen is called.',
        )
      }
    },
    bindCLIShortcuts(options) {
      bindCLIShortcuts(server, options)
    },
    async restart(forceOptimize) {
      if (!server._restartPromise) {
        server._forceOptimizeOnRestart = !!forceOptimize
        server._restartPromise = restartServer(server).finally(() => {
          server._restartPromise = null
          server._forceOptimizeOnRestart = false
        })
      }
      return server._restartPromise
    },
    waitForRequestsIdle,
    _registerRequestProcessing,
    _onCrawlEnd,
    _setInternalServer(_server) {
      // Rebind internal the server variable so functions reference the user
      // server instance after a restart
      server = _server
    },
    _restartPromise: null,
    _importGlobMap: new Map(),
    _forceOptimizeOnRestart: false,
    _pendingRequests: new Map(),
    _fsDenyGlob: picomatch(
      // matchBase: true does not work as it's documented
      // https://github.com/micromatch/picomatch/issues/89
      // convert patterns without `/` on our side for now
      config.server.fs.deny.map((pattern) =>
        pattern.includes('/') ? pattern : `**/${pattern}`,
      ),
      {
        matchBase: false,
        nocase: true,
        dot: true,
      },
    ),
    _shortcutsOptions: undefined,
  }
  // maintain consistency with the server instance after restarting.
  const reflexServer = new Proxy(server, {
    get: (_, property) => {
      return server[property]
    },
    set: (_, property, value) => {
      server[property] = value
      return true
    },
  })
  const closeServerAndExit = async () => {
    try {
      await server.close()
    } finally {
      process.exit()
    }
  }
  if (!middlewareMode) {
    setupSIGTERMListener(closeServerAndExit)
  }
  const onHMRUpdate = async (type, file) => {
    if (serverConfig.hmr !== false) {
      try {
        await handleHMRUpdate(type, file, server)
      } catch (err) {
        hot.send({
          type: 'error',
          err: prepareError(err),
        })
      }
    }
  }
  const onFileAddUnlink = async (file, isUnlink) => {
    file = normalizePath(file)
    await container.watchChange(file, { event: isUnlink ? 'delete' : 'create' })
    if (publicDir && publicFiles) {
      if (file.startsWith(publicDir)) {
        const path = file.slice(publicDir.length)
        publicFiles[isUnlink ? 'delete' : 'add'](path)
        if (!isUnlink) {
          const moduleWithSamePath = await moduleGraph.getModuleByUrl(path)
          const etag = moduleWithSamePath?.transformResult?.etag
          if (etag) {
            // The public file should win on the next request over a module with the
            // same path. Prevent the transform etag fast path from serving the module
            moduleGraph.etagToModuleMap.delete(etag)
          }
        }
      }
    }
    if (isUnlink) moduleGraph.onFileDelete(file)
    await onHMRUpdate(isUnlink ? 'delete' : 'create', file)
  }
  watcher.on('change', async (file) => {
    file = normalizePath(file)
    await container.watchChange(file, { event: 'update' })
    // invalidate module graph cache on file change
    moduleGraph.onFileChange(file)
    await onHMRUpdate('update', file)
  })
  getFsUtils(config).initWatcher?.(watcher)
  watcher.on('add', (file) => {
    onFileAddUnlink(file, false)
  })
  watcher.on('unlink', (file) => {
    onFileAddUnlink(file, true)
  })
  hot.on('vite:invalidate', async ({ path, message }) => {
    const mod = moduleGraph.urlToModuleMap.get(path)
    if (
      mod &&
      mod.isSelfAccepting &&
      mod.lastHMRTimestamp > 0 &&
      !mod.lastHMRInvalidationReceived
    ) {
      mod.lastHMRInvalidationReceived = true
      config.logger.info(
        colors.yellow(`hmr invalidate `) +
          colors.dim(path) +
          (message ? ` ${message}` : ''),
        { timestamp: true },
      )
      const file = getShortName(mod.file, config.root)
      updateModules(
        file,
        [...mod.importers],
        mod.lastHMRTimestamp,
        server,
        true,
      )
    }
  })
  if (!middlewareMode && httpServer) {
    httpServer.once('listening', () => {
      // update actual port since this may be different from initial value
      serverConfig.port = httpServer.address().port
    })
  }
  // apply server configuration hooks from plugins
  const postHooks = []
  for (const hook of config.getSortedPluginHooks('configureServer')) {
    postHooks.push(await hook(reflexServer))
  }
  // Internal middlewares ------------------------------------------------------
  // request timer
  if (process.env.DEBUG) {
    middlewares.use(timeMiddleware(root))
  }
  // cors (enabled by default)
  const { cors } = serverConfig
  if (cors !== false) {
    middlewares.use(corsMiddleware(typeof cors === 'boolean' ? {} : cors))
  }
  middlewares.use(cachedTransformMiddleware(server))
  // proxy
  const { proxy } = serverConfig
  if (proxy) {
    const middlewareServer =
      (isObject(middlewareMode) ? middlewareMode.server : null) || httpServer
    middlewares.use(proxyMiddleware(middlewareServer, proxy, config))
  }
  // base
  if (config.base !== '/') {
    middlewares.use(baseMiddleware(config.rawBase, !!middlewareMode))
  }
  // open in editor support
  middlewares.use('/__open-in-editor', launchEditorMiddleware())
  // ping request handler
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  middlewares.use(function viteHMRPingMiddleware(req, res, next) {
    if (req.headers['accept'] === 'text/x-vite-ping') {
      res.writeHead(204).end()
    } else {
      next()
    }
  })
  // serve static files under /public
  // this applies before the transform middleware so that these files are served
  // as-is without transforms.
  if (publicDir) {
    middlewares.use(servePublicMiddleware(server, publicFiles))
  }
  // main transform middleware
  middlewares.use(transformMiddleware(server))
  // serve static files
  middlewares.use(serveRawFsMiddleware(server))
  middlewares.use(serveStaticMiddleware(server))
  // html fallback
  if (config.appType === 'spa' || config.appType === 'mpa') {
    middlewares.use(
      htmlFallbackMiddleware(
        root,
        config.appType === 'spa',
        getFsUtils(config),
      ),
    )
  }
  // run post config hooks
  // This is applied before the html middleware so that user middleware can
  // serve custom content instead of index.html.
  postHooks.forEach((fn) => fn && fn())
  if (config.appType === 'spa' || config.appType === 'mpa') {
    // transform index.html
    middlewares.use(indexHtmlMiddleware(root, server))
    // handle 404s
    middlewares.use(notFoundMiddleware())
  }
  // error handler
  middlewares.use(errorMiddleware(server, !!middlewareMode))
  // httpServer.listen can be called multiple times
  // when port when using next port number
  // this code is to avoid calling buildStart multiple times
  let initingServer
  let serverInited = false
  const initServer = async () => {
    if (serverInited) return
    if (initingServer) return initingServer
    initingServer = (async function () {
      await container.buildStart({})
      // start deps optimizer after all container plugins are ready
      if (isDepsOptimizerEnabled(config, false)) {
        await initDepsOptimizer(config, server)
      }
      warmupFiles(server)
      initingServer = undefined
      serverInited = true
    })()
    return initingServer
  }
  if (!middlewareMode && httpServer) {
    // overwrite listen to init optimizer before server start
    const listen = httpServer.listen.bind(httpServer)
    httpServer.listen = async (port, ...args) => {
      try {
        // ensure ws server started
        hot.listen()
        await initServer()
      } catch (e) {
        httpServer.emit('error', e)
        return
      }
      return listen(port, ...args)
    }
  } else {
    if (options.hotListen) {
      hot.listen()
    }
    await initServer()
  }
  return server
}
async function startServer(server, inlinePort) {
  const httpServer = server.httpServer
  if (!httpServer) {
    throw new Error('Cannot call server.listen in middleware mode.')
  }
  const options = server.config.server
  const hostname = await resolveHostname(options.host)
  const configPort = inlinePort ?? options.port
  // When using non strict port for the dev server, the running port can be different from the config one.
  // When restarting, the original port may be available but to avoid a switch of URL for the running
  // browser tabs, we enforce the previously used port, expect if the config port changed.
  const port =
    (!configPort || configPort === server._configServerPort
      ? server._currentServerPort
      : configPort) ?? DEFAULT_DEV_PORT
  server._configServerPort = configPort
  const serverPort = await httpServerStart(httpServer, {
    port,
    strictPort: options.strictPort,
    host: hostname.host,
    logger: server.config.logger,
  })
  server._currentServerPort = serverPort
}
export function createServerCloseFn(server) {
  if (!server) {
    return () => Promise.resolve()
  }
  let hasListened = false
  const openSockets = new Set()
  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })
  server.once('listening', () => {
    hasListened = true
  })
  return () =>
    new Promise((resolve, reject) => {
      openSockets.forEach((s) => s.destroy())
      if (hasListened) {
        server.close((err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      } else {
        resolve()
      }
    })
}
function resolvedAllowDir(root, dir) {
  return normalizePath(path.resolve(root, dir))
}
export function resolveServerOptions(root, raw, logger) {
  const server = {
    preTransformRequests: true,
    ...raw,
    sourcemapIgnoreList:
      raw?.sourcemapIgnoreList === false
        ? () => false
        : raw?.sourcemapIgnoreList || isInNodeModules,
    middlewareMode: raw?.middlewareMode || false,
  }
  let allowDirs = server.fs?.allow
  const deny = server.fs?.deny || ['.env', '.env.*', '*.{crt,pem}']
  if (!allowDirs) {
    allowDirs = [searchForWorkspaceRoot(root)]
  }
  if (process.versions.pnp) {
    try {
      const enableGlobalCache =
        execSync('yarn config get enableGlobalCache', { cwd: root })
          .toString()
          .trim() === 'true'
      const yarnCacheDir = execSync(
        `yarn config get ${enableGlobalCache ? 'globalFolder' : 'cacheFolder'}`,
        { cwd: root },
      )
        .toString()
        .trim()
      allowDirs.push(yarnCacheDir)
    } catch (e) {
      logger.warn(`Get yarn cache dir error: ${e.message}`, {
        timestamp: true,
      })
    }
  }
  allowDirs = allowDirs.map((i) => resolvedAllowDir(root, i))
  // only push client dir when vite itself is outside-of-root
  const resolvedClientDir = resolvedAllowDir(root, CLIENT_DIR)
  if (!allowDirs.some((dir) => isParentDirectory(dir, resolvedClientDir))) {
    allowDirs.push(resolvedClientDir)
  }
  server.fs = {
    strict: server.fs?.strict ?? true,
    allow: allowDirs,
    deny,
    cachedChecks: server.fs?.cachedChecks,
  }
  if (server.origin?.endsWith('/')) {
    server.origin = server.origin.slice(0, -1)
    logger.warn(
      colors.yellow(
        `${colors.bold('(!)')} server.origin should not end with "/". Using "${server.origin}" instead.`,
      ),
    )
  }
  return server
}
async function restartServer(server) {
  global.__vite_start_time = performance.now()
  const shortcutsOptions = server._shortcutsOptions
  let inlineConfig = server.config.inlineConfig
  if (server._forceOptimizeOnRestart) {
    inlineConfig = mergeConfig(inlineConfig, {
      optimizeDeps: {
        force: true,
      },
    })
  }
  // Reinit the server by creating a new instance using the same inlineConfig
  // This will trigger a reload of the config file and re-create the plugins and
  // middlewares. We then assign all properties of the new server to the existing
  // server instance and set the user instance to be used in the new server.
  // This allows us to keep the same server instance for the user.
  {
    let newServer = null
    try {
      // delay ws server listen
      newServer = await _createServer(inlineConfig, { hotListen: false })
    } catch (err) {
      server.config.logger.error(err.message, {
        timestamp: true,
      })
      server.config.logger.error('server restart failed', { timestamp: true })
      return
    }
    await server.close()
    // Assign new server props to existing server instance
    const middlewares = server.middlewares
    newServer._configServerPort = server._configServerPort
    newServer._currentServerPort = server._currentServerPort
    Object.assign(server, newServer)
    // Keep the same connect instance so app.use(vite.middlewares) works
    // after a restart in middlewareMode (.route is always '/')
    middlewares.stack = newServer.middlewares.stack
    server.middlewares = middlewares
    // Rebind internal server variable so functions reference the user server
    newServer._setInternalServer(server)
  }
  const {
    logger,
    server: { port, middlewareMode },
  } = server.config
  if (!middlewareMode) {
    await server.listen(port, true)
  } else {
    server.hot.listen()
  }
  logger.info('server restarted.', { timestamp: true })
  if (shortcutsOptions) {
    shortcutsOptions.print = false
    bindCLIShortcuts(server, shortcutsOptions)
  }
}
/**
 * Internal function to restart the Vite server and print URLs if changed
 */
export async function restartServerWithUrls(server) {
  if (server.config.server.middlewareMode) {
    await server.restart()
    return
  }
  const { port: prevPort, host: prevHost } = server.config.server
  const prevUrls = server.resolvedUrls
  await server.restart()
  const {
    logger,
    server: { port, host },
  } = server.config
  if (
    (port ?? DEFAULT_DEV_PORT) !== (prevPort ?? DEFAULT_DEV_PORT) ||
    host !== prevHost ||
    diffDnsOrderChange(prevUrls, server.resolvedUrls)
  ) {
    logger.info('')
    server.printUrls()
  }
}
const callCrawlEndIfIdleAfterMs = 50
function setupOnCrawlEnd(onCrawlEnd) {
  const registeredIds = new Set()
  const seenIds = new Set()
  const onCrawlEndPromiseWithResolvers = promiseWithResolvers()
  let timeoutHandle
  let cancelled = false
  function cancel() {
    cancelled = true
  }
  let crawlEndCalled = false
  function callOnCrawlEnd() {
    if (!cancelled && !crawlEndCalled) {
      crawlEndCalled = true
      onCrawlEnd()
    }
    onCrawlEndPromiseWithResolvers.resolve()
  }
  function registerRequestProcessing(id, done) {
    if (!seenIds.has(id)) {
      seenIds.add(id)
      registeredIds.add(id)
      done()
        .catch(() => {})
        .finally(() => markIdAsDone(id))
    }
  }
  function waitForRequestsIdle(ignoredId) {
    if (ignoredId) {
      seenIds.add(ignoredId)
      markIdAsDone(ignoredId)
    }
    return onCrawlEndPromiseWithResolvers.promise
  }
  function markIdAsDone(id) {
    if (registeredIds.has(id)) {
      registeredIds.delete(id)
      checkIfCrawlEndAfterTimeout()
    }
  }
  function checkIfCrawlEndAfterTimeout() {
    if (cancelled || registeredIds.size > 0) return
    if (timeoutHandle) clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(
      callOnCrawlEndWhenIdle,
      callCrawlEndIfIdleAfterMs,
    )
  }
  async function callOnCrawlEndWhenIdle() {
    if (cancelled || registeredIds.size > 0) return
    callOnCrawlEnd()
  }
  return {
    registerRequestProcessing,
    waitForRequestsIdle,
    cancel,
  }
}
