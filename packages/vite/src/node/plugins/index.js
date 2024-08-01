import aliasPlugin from '@rollup/plugin-alias'
import { isDepsOptimizerEnabled } from '../config'
import { getDepsOptimizer } from '../optimizer'
import { shouldExternalizeForSSR } from '../ssr/ssrExternal'
import { watchPackageDataPlugin } from '../packages'
import { getFsUtils } from '../fsUtils'
import { jsonPlugin } from './json'
import { resolvePlugin } from './resolve'
import { optimizedDepsPlugin } from './optimizedDeps'
import { esbuildPlugin } from './esbuild'
import { importAnalysisPlugin } from './importAnalysis'
import { cssAnalysisPlugin, cssPlugin, cssPostPlugin } from './css'
import { assetPlugin } from './asset'
import { clientInjectionsPlugin } from './clientInjections'
import { buildHtmlPlugin, htmlInlineProxyPlugin } from './html'
import { wasmFallbackPlugin, wasmHelperPlugin } from './wasm'
import { modulePreloadPolyfillPlugin } from './modulePreloadPolyfill'
import { webWorkerPlugin } from './worker'
import { preAliasPlugin } from './preAlias'
import { definePlugin } from './define'
import { workerImportMetaUrlPlugin } from './workerImportMetaUrl'
import { assetImportMetaUrlPlugin } from './assetImportMetaUrl'
import { metadataPlugin } from './metadata'
import { dynamicImportVarsPlugin } from './dynamicImportVars'
import { importGlobPlugin } from './importMetaGlob'
export async function resolvePlugins(
  config,
  prePlugins,
  normalPlugins,
  postPlugins,
) {
  const isBuild = config.command === 'build'
  const isWorker = config.isWorker
  const buildPlugins = isBuild
    ? await (await import('../build')).resolveBuildPlugins(config)
    : { pre: [], post: [] }
  const { modulePreload } = config.build
  const depsOptimizerEnabled =
    !isBuild &&
    (isDepsOptimizerEnabled(config, false) ||
      isDepsOptimizerEnabled(config, true))
  return [
    depsOptimizerEnabled ? optimizedDepsPlugin(config) : null,
    isBuild ? metadataPlugin() : null,
    !isWorker ? watchPackageDataPlugin(config.packageCache) : null,
    preAliasPlugin(config),
    aliasPlugin({
      entries: config.resolve.alias,
      customResolver: viteAliasCustomResolver,
    }),
    ...prePlugins,
    modulePreload !== false && modulePreload.polyfill
      ? modulePreloadPolyfillPlugin(config)
      : null,
    resolvePlugin({
      ...config.resolve,
      root: config.root,
      isProduction: config.isProduction,
      isBuild,
      packageCache: config.packageCache,
      ssrConfig: config.ssr,
      asSrc: true,
      fsUtils: getFsUtils(config),
      getDepsOptimizer: isBuild
        ? undefined
        : (ssr) => getDepsOptimizer(config, ssr),
      shouldExternalize:
        isBuild && config.build.ssr
          ? (id, importer) => shouldExternalizeForSSR(id, importer, config)
          : undefined,
    }),
    htmlInlineProxyPlugin(config),
    cssPlugin(config),
    config.esbuild !== false ? esbuildPlugin(config) : null,
    jsonPlugin(
      {
        namedExports: true,
        ...config.json,
      },
      isBuild,
    ),
    wasmHelperPlugin(config),
    webWorkerPlugin(config),
    assetPlugin(config),
    ...normalPlugins,
    wasmFallbackPlugin(),
    definePlugin(config),
    cssPostPlugin(config),
    isBuild && buildHtmlPlugin(config),
    workerImportMetaUrlPlugin(config),
    assetImportMetaUrlPlugin(config),
    ...buildPlugins.pre,
    dynamicImportVarsPlugin(config),
    importGlobPlugin(config),
    ...postPlugins,
    ...buildPlugins.post,
    // internal server-only plugins are always applied after everything else
    ...(isBuild
      ? []
      : [
          clientInjectionsPlugin(config),
          cssAnalysisPlugin(config),
          importAnalysisPlugin(config),
        ]),
  ].filter(Boolean)
}
export function createPluginHookUtils(plugins) {
  // sort plugins per hook
  const sortedPluginsCache = new Map()
  function getSortedPlugins(hookName) {
    if (sortedPluginsCache.has(hookName))
      return sortedPluginsCache.get(hookName)
    const sorted = getSortedPluginsByHook(hookName, plugins)
    sortedPluginsCache.set(hookName, sorted)
    return sorted
  }
  function getSortedPluginHooks(hookName) {
    const plugins = getSortedPlugins(hookName)
    return plugins.map((p) => getHookHandler(p[hookName])).filter(Boolean)
  }
  return {
    getSortedPlugins,
    getSortedPluginHooks,
  }
}
export function getSortedPluginsByHook(hookName, plugins) {
  const sortedPlugins = []
  // Use indexes to track and insert the ordered plugins directly in the
  // resulting array to avoid creating 3 extra temporary arrays per hook
  let pre = 0,
    normal = 0,
    post = 0
  for (const plugin of plugins) {
    const hook = plugin[hookName]
    if (hook) {
      if (typeof hook === 'object') {
        if (hook.order === 'pre') {
          sortedPlugins.splice(pre++, 0, plugin)
          continue
        }
        if (hook.order === 'post') {
          sortedPlugins.splice(pre + normal + post++, 0, plugin)
          continue
        }
      }
      sortedPlugins.splice(pre + normal++, 0, plugin)
    }
  }
  return sortedPlugins
}
export function getHookHandler(hook) {
  return typeof hook === 'object' ? hook.handler : hook
}
// Same as `@rollup/plugin-alias` default resolver, but we attach additional meta
// if we can't resolve to something, which will error in `importAnalysis`
export const viteAliasCustomResolver = async function (id, importer, options) {
  const resolved = await this.resolve(id, importer, options)
  return resolved || { id, meta: { 'vite:alias': { noResolved: true } } }
}
