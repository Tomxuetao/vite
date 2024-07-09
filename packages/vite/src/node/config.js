import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import colors from 'picocolors'
import aliasPlugin from '@rollup/plugin-alias'
import { build } from 'esbuild'
import { withTrailingSlash } from '../shared/utils'
import {
  CLIENT_ENTRY,
  DEFAULT_ASSETS_RE,
  DEFAULT_CONFIG_FILES,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  ENV_ENTRY,
  FS_PREFIX,
} from './constants'
import { resolveBuildOptions } from './build'
import { resolveServerOptions } from './server'
import { resolvePreviewOptions } from './preview'
import { resolveCSSOptions } from './plugins/css'
import {
  asyncFlatten,
  createDebugger,
  createFilter,
  isBuiltin,
  isExternalUrl,
  isFilePathESM,
  isNodeBuiltin,
  isObject,
  isParentDirectory,
  mergeAlias,
  mergeConfig,
  normalizeAlias,
  normalizePath,
} from './utils'
import { getFsUtils } from './fsUtils'
import {
  createPluginHookUtils,
  getHookHandler,
  getSortedPluginsByHook,
  resolvePlugins,
} from './plugins'
import { resolvePlugin, tryNodeResolve } from './plugins/resolve'
import { createLogger } from './logger'
import { createPluginContainer } from './server/pluginContainer'
import { findNearestPackageData } from './packages'
import { loadEnv, resolveEnvPrefix } from './env'
import { resolveSSROptions } from './ssr'
const debug = createDebugger('vite:config')
const promisifiedRealpath = promisify(fs.realpath)
export function defineConfig(config) {
  return config
}
/**
 * Check and warn if `path` includes characters that don't work well in Vite,
 * such as `#` and `?`.
 */
function checkBadCharactersInPath(path, logger) {
  const badChars = []
  if (path.includes('#')) {
    badChars.push('#')
  }
  if (path.includes('?')) {
    badChars.push('?')
  }
  if (badChars.length > 0) {
    const charString = badChars.map((c) => `"${c}"`).join(' and ')
    const inflectedChars = badChars.length > 1 ? 'characters' : 'character'
    logger.warn(
      colors.yellow(
        `The project root contains the ${charString} ${inflectedChars} (${colors.cyan(path)}), which may not work when running Vite. Consider renaming the directory to remove the characters.`,
      ),
    )
  }
}
export async function resolveConfig(
  inlineConfig,
  command,
  defaultMode = 'development',
  defaultNodeEnv = 'development',
  isPreview = false,
) {
  let config = inlineConfig
  let configFileDependencies = []
  let mode = inlineConfig.mode || defaultMode
  const isNodeEnvSet = !!process.env.NODE_ENV
  const packageCache = new Map()
  // some dependencies e.g. @vue/compiler-* relies on NODE_ENV for getting
  // production-specific behavior, so set it early on
  if (!isNodeEnvSet) {
    process.env.NODE_ENV = defaultNodeEnv
  }
  const configEnv = {
    mode,
    command,
    isSsrBuild: command === 'build' && !!config.build?.ssr,
    isPreview,
  }
  let { configFile } = config
  if (configFile !== false) {
    const loadResult = await loadConfigFromFile(
      configEnv,
      configFile,
      config.root,
      config.logLevel,
      config.customLogger,
    )
    if (loadResult) {
      config = mergeConfig(loadResult.config, config)
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
  }
  // user config may provide an alternative mode. But --mode has a higher priority
  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode
  const filterPlugin = (p) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  }
  // resolve plugins
  const rawUserPlugins = (await asyncFlatten(config.plugins || [])).filter(
    filterPlugin,
  )
  const [prePlugins, normalPlugins, postPlugins] =
    sortUserPlugins(rawUserPlugins)
  // run config hooks
  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]
  config = await runConfigHook(config, userPlugins, configEnv)
  // Define logger
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
    customLogger: config.customLogger,
  })
  // resolve root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd(),
  )
  checkBadCharactersInPath(resolvedRoot, logger)
  const clientAlias = [
    {
      find: /^\/?@vite\/env/,
      replacement: path.posix.join(FS_PREFIX, normalizePath(ENV_ENTRY)),
    },
    {
      find: /^\/?@vite\/client/,
      replacement: path.posix.join(FS_PREFIX, normalizePath(CLIENT_ENTRY)),
    },
  ]
  // resolve alias with internal client alias
  const resolvedAlias = normalizeAlias(
    mergeAlias(clientAlias, config.resolve?.alias || []),
  )
  const resolveOptions = {
    mainFields: config.resolve?.mainFields ?? DEFAULT_MAIN_FIELDS,
    conditions: config.resolve?.conditions ?? [],
    extensions: config.resolve?.extensions ?? DEFAULT_EXTENSIONS,
    dedupe: config.resolve?.dedupe ?? [],
    preserveSymlinks: config.resolve?.preserveSymlinks ?? false,
    alias: resolvedAlias,
  }
  if (
    // @ts-expect-error removed field
    config.resolve?.browserField === false &&
    resolveOptions.mainFields.includes('browser')
  ) {
    logger.warn(
      colors.yellow(
        `\`resolve.browserField\` is set to false, but the option is removed in favour of ` +
          `the 'browser' string in \`resolve.mainFields\`. You may want to update \`resolve.mainFields\` ` +
          `to remove the 'browser' string and preserve the previous browser behaviour.`,
      ),
    )
  }
  // load .env files
  const envDir = config.envDir
    ? normalizePath(path.resolve(resolvedRoot, config.envDir))
    : resolvedRoot
  const userEnv =
    inlineConfig.envFile !== false &&
    loadEnv(mode, envDir, resolveEnvPrefix(config))
  // Note it is possible for user to have a custom mode, e.g. `staging` where
  // development-like behavior is expected. This is indicated by NODE_ENV=development
  // loaded from `.staging.env` and set by us as VITE_USER_NODE_ENV
  const userNodeEnv = process.env.VITE_USER_NODE_ENV
  if (!isNodeEnvSet && userNodeEnv) {
    if (userNodeEnv === 'development') {
      process.env.NODE_ENV = 'development'
    } else {
      // NODE_ENV=production is not supported as it could break HMR in dev for frameworks like Vue
      logger.warn(
        `NODE_ENV=${userNodeEnv} is not supported in the .env file. ` +
          `Only NODE_ENV=development is supported to create a development build of your project. ` +
          `If you need to set process.env.NODE_ENV, you can set it in the Vite config instead.`,
      )
    }
  }
  const isProduction = process.env.NODE_ENV === 'production'
  // resolve public base url
  const isBuild = command === 'build'
  const relativeBaseShortcut = config.base === '' || config.base === './'
  // During dev, we ignore relative base and fallback to '/'
  // For the SSR build, relative base isn't possible by means
  // of import.meta.url.
  const resolvedBase = relativeBaseShortcut
    ? !isBuild || config.build?.ssr
      ? '/'
      : './'
    : resolveBaseUrl(config.base, isBuild, logger) ?? '/'
  const resolvedBuildOptions = resolveBuildOptions(
    config.build,
    logger,
    resolvedRoot,
  )
  // resolve cache directory
  const pkgDir = findNearestPackageData(resolvedRoot, packageCache)?.dir
  const cacheDir = normalizePath(
    config.cacheDir
      ? path.resolve(resolvedRoot, config.cacheDir)
      : pkgDir
        ? path.join(pkgDir, `node_modules/.vite`)
        : path.join(resolvedRoot, `.vite`),
  )
  const assetsFilter =
    config.assetsInclude &&
    (!Array.isArray(config.assetsInclude) || config.assetsInclude.length)
      ? createFilter(config.assetsInclude)
      : () => false
  // create an internal resolver to be used in special scenarios, e.g.
  // optimizer & handling css @imports
  const createResolver = (options) => {
    let aliasContainer
    let resolverContainer
    return async (id, importer, aliasOnly, ssr) => {
      let container
      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [aliasPlugin({ entries: resolved.resolve.alias })],
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              aliasPlugin({ entries: resolved.resolve.alias }),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                ssrConfig: resolved.ssr,
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options,
                idOnly: true,
                fsUtils: getFsUtils(resolved),
              }),
            ],
          }))
      }
      return (
        await container.resolveId(id, importer, {
          ssr,
          scan: options?.scan,
        })
      )?.id
    }
  }
  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? normalizePath(
          path.resolve(
            resolvedRoot,
            typeof publicDir === 'string' ? publicDir : 'public',
          ),
        )
      : ''
  const server = resolveServerOptions(resolvedRoot, config.server, logger)
  const ssr = resolveSSROptions(config.ssr, resolveOptions.preserveSymlinks)
  const optimizeDeps = config.optimizeDeps || {}
  const BASE_URL = resolvedBase
  let resolved
  let createUserWorkerPlugins = config.worker?.plugins
  if (Array.isArray(createUserWorkerPlugins)) {
    // @ts-expect-error backward compatibility
    createUserWorkerPlugins = () => config.worker?.plugins
    logger.warn(
      colors.yellow(
        `worker.plugins is now a function that returns an array of plugins. ` +
          `Please update your Vite config accordingly.\n`,
      ),
    )
  }
  const createWorkerPlugins = async function (bundleChain) {
    // Some plugins that aren't intended to work in the bundling of workers (doing post-processing at build time for example).
    // And Plugins may also have cached that could be corrupted by being used in these extra rollup calls.
    // So we need to separate the worker plugin from the plugin that vite needs to run.
    const rawWorkerUserPlugins = (
      await asyncFlatten(createUserWorkerPlugins?.() || [])
    ).filter(filterPlugin)
    // resolve worker
    let workerConfig = mergeConfig({}, config)
    const [workerPrePlugins, workerNormalPlugins, workerPostPlugins] =
      sortUserPlugins(rawWorkerUserPlugins)
    // run config hooks
    const workerUserPlugins = [
      ...workerPrePlugins,
      ...workerNormalPlugins,
      ...workerPostPlugins,
    ]
    workerConfig = await runConfigHook(
      workerConfig,
      workerUserPlugins,
      configEnv,
    )
    const workerResolved = {
      ...workerConfig,
      ...resolved,
      isWorker: true,
      mainConfig: resolved,
      bundleChain,
    }
    const resolvedWorkerPlugins = await resolvePlugins(
      workerResolved,
      workerPrePlugins,
      workerNormalPlugins,
      workerPostPlugins,
    )
    // run configResolved hooks
    await Promise.all(
      createPluginHookUtils(resolvedWorkerPlugins)
        .getSortedPluginHooks('configResolved')
        .map((hook) => hook(workerResolved)),
    )
    return resolvedWorkerPlugins
  }
  const resolvedWorkerOptions = {
    format: config.worker?.format || 'iife',
    plugins: createWorkerPlugins,
    rollupOptions: config.worker?.rollupOptions || {},
  }
  resolved = {
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies: configFileDependencies.map((name) =>
      normalizePath(path.resolve(name)),
    ),
    inlineConfig,
    root: resolvedRoot,
    base: withTrailingSlash(resolvedBase),
    rawBase: resolvedBase,
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    ssr,
    isWorker: false,
    mainConfig: null,
    bundleChain: [],
    isProduction,
    plugins: userPlugins,
    css: resolveCSSOptions(config.css),
    esbuild:
      config.esbuild === false
        ? false
        : {
            jsxDev: !isProduction,
            ...config.esbuild,
          },
    server,
    build: resolvedBuildOptions,
    preview: resolvePreviewOptions(config.preview, server),
    envDir,
    env: {
      ...userEnv,
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction,
    },
    assetsInclude(file) {
      return DEFAULT_ASSETS_RE.test(file) || assetsFilter(file)
    },
    logger,
    packageCache,
    createResolver,
    optimizeDeps: {
      holdUntilCrawlEnd: true,
      ...optimizeDeps,
      esbuildOptions: {
        preserveSymlinks: resolveOptions.preserveSymlinks,
        ...optimizeDeps.esbuildOptions,
      },
    },
    worker: resolvedWorkerOptions,
    appType: config.appType ?? 'spa',
    experimental: {
      importGlobRestoreExtension: false,
      hmrPartialAccept: false,
      ...config.experimental,
    },
    getSortedPlugins: undefined,
    getSortedPluginHooks: undefined,
  }
  resolved = {
    ...config,
    ...resolved,
  }
  resolved.plugins = await resolvePlugins(
    resolved,
    prePlugins,
    normalPlugins,
    postPlugins,
  )
  Object.assign(resolved, createPluginHookUtils(resolved.plugins))
  // call configResolved hooks
  await Promise.all(
    resolved
      .getSortedPluginHooks('configResolved')
      .map((hook) => hook(resolved)),
  )
  optimizeDepsDisabledBackwardCompatibility(resolved, resolved.optimizeDeps)
  optimizeDepsDisabledBackwardCompatibility(
    resolved,
    resolved.ssr.optimizeDeps,
    'ssr.',
  )
  debug?.(`using resolved config: %O`, {
    ...resolved,
    plugins: resolved.plugins.map((p) => p.name),
    worker: {
      ...resolved.worker,
      plugins: `() => plugins`,
    },
  })
  // validate config
  if (
    config.build?.terserOptions &&
    config.build.minify &&
    config.build.minify !== 'terser'
  ) {
    logger.warn(
      colors.yellow(
        `build.terserOptions is specified but build.minify is not set to use Terser. ` +
          `Note Vite now defaults to use esbuild for minification. If you still ` +
          `prefer Terser, set build.minify to "terser".`,
      ),
    )
  }
  // Check if all assetFileNames have the same reference.
  // If not, display a warn for user.
  const outputOption = config.build?.rollupOptions?.output ?? []
  // Use isArray to narrow its type to array
  if (Array.isArray(outputOption)) {
    const assetFileNamesList = outputOption.map(
      (output) => output.assetFileNames,
    )
    if (assetFileNamesList.length > 1) {
      const firstAssetFileNames = assetFileNamesList[0]
      const hasDifferentReference = assetFileNamesList.some(
        (assetFileNames) => assetFileNames !== firstAssetFileNames,
      )
      if (hasDifferentReference) {
        resolved.logger.warn(
          colors.yellow(`
assetFileNames isn't equal for every build.rollupOptions.output. A single pattern across all outputs is supported by Vite.
`),
        )
      }
    }
  }
  // Warn about removal of experimental features
  if (
    // @ts-expect-error Option removed
    config.legacy?.buildSsrCjsExternalHeuristics ||
    // @ts-expect-error Option removed
    config.ssr?.format === 'cjs'
  ) {
    resolved.logger.warn(
      colors.yellow(`
(!) Experimental legacy.buildSsrCjsExternalHeuristics and ssr.format were be removed in Vite 5.
    The only SSR Output format is ESM. Find more information at https://github.com/vitejs/vite/discussions/13816.
`),
    )
  }
  const resolvedBuildOutDir = normalizePath(
    path.resolve(resolved.root, resolved.build.outDir),
  )
  if (
    isParentDirectory(resolvedBuildOutDir, resolved.root) ||
    resolvedBuildOutDir === resolved.root
  ) {
    resolved.logger.warn(
      colors.yellow(`
(!) build.outDir must not be the same directory of root or a parent directory of root as this could cause Vite to overwriting source files with build outputs.
`),
    )
  }
  return resolved
}
/**
 * Resolve base url. Note that some users use Vite to build for non-web targets like
 * electron or expects to deploy
 */
export function resolveBaseUrl(base = '/', isBuild, logger) {
  if (base[0] === '.') {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) invalid "base" option: "${base}". The value can only be an absolute ` +
            `URL, "./", or an empty string.`,
        ),
      ),
    )
    return '/'
  }
  // external URL flag
  const isExternal = isExternalUrl(base)
  // no leading slash warn
  if (!isExternal && base[0] !== '/') {
    logger.warn(
      colors.yellow(
        colors.bold(`(!) "base" option should start with a slash.`),
      ),
    )
  }
  // parse base when command is serve or base is not External URL
  if (!isBuild || !isExternal) {
    base = new URL(base, 'http://vitejs.dev').pathname
    // ensure leading slash
    if (base[0] !== '/') {
      base = '/' + base
    }
  }
  return base
}
export function sortUserPlugins(plugins) {
  const prePlugins = []
  const postPlugins = []
  const normalPlugins = []
  if (plugins) {
    plugins.flat().forEach((p) => {
      if (p.enforce === 'pre') prePlugins.push(p)
      else if (p.enforce === 'post') postPlugins.push(p)
      else normalPlugins.push(p)
    })
  }
  return [prePlugins, normalPlugins, postPlugins]
}
export async function loadConfigFromFile(
  configEnv,
  configFile,
  configRoot = process.cwd(),
  logLevel,
  customLogger,
) {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`
  let resolvedPath
  if (configFile) {
    // explicit config path is always resolved from cwd
    resolvedPath = path.resolve(configFile)
  } else {
    // implicit config file loaded from inline root (if present)
    // otherwise from cwd
    for (const filename of DEFAULT_CONFIG_FILES) {
      const filePath = path.resolve(configRoot, filename)
      if (!fs.existsSync(filePath)) continue
      resolvedPath = filePath
      break
    }
  }
  if (!resolvedPath) {
    debug?.('no config file found.')
    return null
  }
  const isESM = isFilePathESM(resolvedPath)
  try {
    const bundled = await bundleConfigFile(resolvedPath, isESM)
    const userConfig = await loadConfigFromBundledFile(
      resolvedPath,
      bundled.code,
      isESM,
    )
    debug?.(`bundled config file loaded in ${getTime()}`)
    const config = await (typeof userConfig === 'function'
      ? userConfig(configEnv)
      : userConfig)
    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }
    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies: bundled.dependencies,
    }
  } catch (e) {
    createLogger(logLevel, { customLogger }).error(
      colors.red(`failed to load config from ${resolvedPath}`),
      {
        error: e,
      },
    )
    throw e
  }
}
async function bundleConfigFile(fileName, isESM) {
  const dirnameVarName = '__vite_injected_original_dirname'
  const filenameVarName = '__vite_injected_original_filename'
  const importMetaUrlVarName = '__vite_injected_original_import_meta_url'
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    write: false,
    target: ['node18'],
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    mainFields: ['main'],
    sourcemap: 'inline',
    metafile: true,
    define: {
      __dirname: dirnameVarName,
      __filename: filenameVarName,
      'import.meta.url': importMetaUrlVarName,
      'import.meta.dirname': dirnameVarName,
      'import.meta.filename': filenameVarName,
    },
    plugins: [
      {
        name: 'externalize-deps',
        setup(build) {
          const packageCache = new Map()
          const resolveByViteResolver = (id, importer, isRequire) => {
            return tryNodeResolve(
              id,
              importer,
              {
                root: path.dirname(fileName),
                isBuild: true,
                isProduction: true,
                preferRelative: false,
                tryIndex: true,
                mainFields: [],
                conditions: [],
                overrideConditions: ['node'],
                dedupe: [],
                extensions: DEFAULT_EXTENSIONS,
                preserveSymlinks: false,
                packageCache,
                isRequire,
              },
              false,
            )?.id
          }
          // externalize bare imports
          build.onResolve(
            { filter: /^[^.].*/ },
            async ({ path: id, importer, kind }) => {
              if (
                kind === 'entry-point' ||
                path.isAbsolute(id) ||
                isNodeBuiltin(id)
              ) {
                return
              }
              // With the `isNodeBuiltin` check above, this check captures if the builtin is a
              // non-node built-in, which esbuild doesn't know how to handle. In that case, we
              // externalize it so the non-node runtime handles it instead.
              if (isBuiltin(id)) {
                return { external: true }
              }
              const isImport = isESM || kind === 'dynamic-import'
              let idFsPath
              try {
                idFsPath = resolveByViteResolver(id, importer, !isImport)
              } catch (e) {
                if (!isImport) {
                  let canResolveWithImport = false
                  try {
                    canResolveWithImport = !!resolveByViteResolver(
                      id,
                      importer,
                      false,
                    )
                  } catch {}
                  if (canResolveWithImport) {
                    throw new Error(
                      `Failed to resolve ${JSON.stringify(id)}. This package is ESM only but it was tried to load by \`require\`. See https://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
                    )
                  }
                }
                throw e
              }
              if (idFsPath && isImport) {
                idFsPath = pathToFileURL(idFsPath).href
              }
              if (
                idFsPath &&
                !isImport &&
                isFilePathESM(idFsPath, packageCache)
              ) {
                throw new Error(
                  `${JSON.stringify(id)} resolved to an ESM file. ESM file cannot be loaded by \`require\`. See https://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
                )
              }
              return {
                path: idFsPath,
                external: true,
              }
            },
          )
        },
      },
      {
        name: 'inject-file-scope-variables',
        setup(build) {
          build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
            const contents = await fsp.readFile(args.path, 'utf-8')
            const injectValues =
              `const ${dirnameVarName} = ${JSON.stringify(path.dirname(args.path))};` +
              `const ${filenameVarName} = ${JSON.stringify(args.path)};` +
              `const ${importMetaUrlVarName} = ${JSON.stringify(pathToFileURL(args.path).href)};`
            return {
              loader: args.path.endsWith('ts') ? 'ts' : 'js',
              contents: injectValues + contents,
            }
          })
        },
      },
    ],
  })
  const { text } = result.outputFiles[0]
  return {
    code: text,
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : [],
  }
}
const _require = createRequire(import.meta.url)
async function loadConfigFromBundledFile(fileName, bundledCode, isESM) {
  // for esm, before we can register loaders without requiring users to run node
  // with --experimental-loader themselves, we have to do a hack here:
  // write it to disk, load it with native Node ESM, then delete the file.
  if (isESM) {
    const fileBase = `${fileName}.timestamp-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
    const fileNameTmp = `${fileBase}.mjs`
    const fileUrl = `${pathToFileURL(fileBase)}.mjs`
    await fsp.writeFile(fileNameTmp, bundledCode)
    try {
      return (await import(fileUrl)).default
    } finally {
      fs.unlink(fileNameTmp, () => {}) // Ignore errors
    }
  }
  // for cjs, we can register a custom loader via `_require.extensions`
  else {
    const extension = path.extname(fileName)
    // We don't use fsp.realpath() here because it has the same behaviour as
    // fs.realpath.native. On some Windows systems, it returns uppercase volume
    // letters (e.g. "C:\") while the Node.js loader uses lowercase volume letters.
    // See https://github.com/vitejs/vite/issues/12923
    const realFileName = await promisifiedRealpath(fileName)
    const loaderExt = extension in _require.extensions ? extension : '.js'
    const defaultLoader = _require.extensions[loaderExt]
    _require.extensions[loaderExt] = (module, filename) => {
      if (filename === realFileName) {
        module._compile(bundledCode, filename)
      } else {
        defaultLoader(module, filename)
      }
    }
    // clear cache in case of server restart
    delete _require.cache[_require.resolve(fileName)]
    const raw = _require(fileName)
    _require.extensions[loaderExt] = defaultLoader
    return raw.__esModule ? raw.default : raw
  }
}
async function runConfigHook(config, plugins, configEnv) {
  let conf = config
  for (const p of getSortedPluginsByHook('config', plugins)) {
    const hook = p.config
    const handler = getHookHandler(hook)
    if (handler) {
      const res = await handler(conf, configEnv)
      if (res) {
        conf = mergeConfig(conf, res)
      }
    }
  }
  return conf
}
export function getDepOptimizationConfig(config, ssr) {
  return ssr ? config.ssr.optimizeDeps : config.optimizeDeps
}
export function isDepsOptimizerEnabled(config, ssr) {
  const optimizeDeps = getDepOptimizationConfig(config, ssr)
  return !(optimizeDeps.noDiscovery && !optimizeDeps.include?.length)
}
function optimizeDepsDisabledBackwardCompatibility(
  resolved,
  optimizeDeps,
  optimizeDepsPath = '',
) {
  const optimizeDepsDisabled = optimizeDeps.disabled
  if (optimizeDepsDisabled !== undefined) {
    if (optimizeDepsDisabled === true || optimizeDepsDisabled === 'dev') {
      const commonjsOptionsInclude = resolved.build?.commonjsOptions?.include
      const commonjsPluginDisabled =
        Array.isArray(commonjsOptionsInclude) &&
        commonjsOptionsInclude.length === 0
      optimizeDeps.noDiscovery = true
      optimizeDeps.include = undefined
      if (commonjsPluginDisabled) {
        resolved.build.commonjsOptions.include = undefined
      }
      resolved.logger.warn(
        colors.yellow(`(!) Experimental ${optimizeDepsPath}optimizeDeps.disabled and deps pre-bundling during build were removed in Vite 5.1.
    To disable the deps optimizer, set ${optimizeDepsPath}optimizeDeps.noDiscovery to true and ${optimizeDepsPath}optimizeDeps.include as undefined or empty.
    Please remove ${optimizeDepsPath}optimizeDeps.disabled from your config.
    ${
      commonjsPluginDisabled
        ? 'Empty config.build.commonjsOptions.include will be ignored to support CJS during build. This config should also be removed.'
        : ''
    }
  `),
      )
    } else if (
      optimizeDepsDisabled === false ||
      optimizeDepsDisabled === 'build'
    ) {
      resolved.logger.warn(
        colors.yellow(`(!) Experimental ${optimizeDepsPath}optimizeDeps.disabled and deps pre-bundling during build were removed in Vite 5.1.
    Setting it to ${optimizeDepsDisabled} now has no effect.
    Please remove ${optimizeDepsPath}optimizeDeps.disabled from your config.
  `),
      )
    }
  }
}
