import path from 'node:path'
import { tryNodeResolve } from '../plugins/resolve'
import {
  bareImportRE,
  createDebugger,
  createFilter,
  getNpmPackageName,
  isBuiltin,
} from '../utils'
const debug = createDebugger('vite:ssr-external')
const isSsrExternalCache = new WeakMap()
export function shouldExternalizeForSSR(id, importer, config) {
  let isSsrExternal = isSsrExternalCache.get(config)
  if (!isSsrExternal) {
    isSsrExternal = createIsSsrExternal(config)
    isSsrExternalCache.set(config, isSsrExternal)
  }
  return isSsrExternal(id, importer)
}
export function createIsConfiguredAsSsrExternal(config) {
  const { ssr, root } = config
  const noExternal = ssr?.noExternal
  const noExternalFilter =
    noExternal !== 'undefined' &&
    typeof noExternal !== 'boolean' &&
    createFilter(undefined, noExternal, { resolve: false })
  const targetConditions = config.ssr.resolve?.externalConditions || []
  const resolveOptions = {
    ...config.resolve,
    root,
    isProduction: false,
    isBuild: true,
    conditions: targetConditions,
  }
  const isExternalizable = (id, importer, configuredAsExternal) => {
    if (!bareImportRE.test(id) || id.includes('\0')) {
      return false
    }
    try {
      return !!tryNodeResolve(
        id,
        // Skip passing importer in build to avoid externalizing non-hoisted dependencies
        // unresolvable from root (which would be unresolvable from output bundles also)
        config.command === 'build' ? undefined : importer,
        resolveOptions,
        ssr?.target === 'webworker',
        undefined,
        true,
        // try to externalize, will return undefined or an object without
        // a external flag if it isn't externalizable
        true,
        // Allow linked packages to be externalized if they are explicitly
        // configured as external
        !!configuredAsExternal,
      )?.external
    } catch (e) {
      debug?.(
        `Failed to node resolve "${id}". Skipping externalizing it by default.`,
      )
      // may be an invalid import that's resolved by a plugin
      return false
    }
  }
  // Returns true if it is configured as external, false if it is filtered
  // by noExternal and undefined if it isn't affected by the explicit config
  return (id, importer) => {
    if (
      // If this id is defined as external, force it as external
      // Note that individual package entries are allowed in ssr.external
      ssr.external !== true &&
      ssr.external?.includes(id)
    ) {
      return true
    }
    const pkgName = getNpmPackageName(id)
    if (!pkgName) {
      return isExternalizable(id, importer)
    }
    if (
      // A package name in ssr.external externalizes every
      // externalizable package entry
      ssr.external !== true &&
      ssr.external?.includes(pkgName)
    ) {
      return isExternalizable(id, importer, true)
    }
    if (typeof noExternal === 'boolean') {
      return !noExternal
    }
    if (noExternalFilter && !noExternalFilter(pkgName)) {
      return false
    }
    // If `ssr.external: true`, all will be externalized by default, regardless if
    // it's a linked package
    return isExternalizable(id, importer, ssr.external === true)
  }
}
function createIsSsrExternal(config) {
  const processedIds = new Map()
  const isConfiguredAsExternal = createIsConfiguredAsSsrExternal(config)
  return (id, importer) => {
    if (processedIds.has(id)) {
      return processedIds.get(id)
    }
    let external = false
    if (id[0] !== '.' && !path.isAbsolute(id)) {
      external = isBuiltin(id) || isConfiguredAsExternal(id, importer)
    }
    processedIds.set(id, external)
    return external
  }
}
