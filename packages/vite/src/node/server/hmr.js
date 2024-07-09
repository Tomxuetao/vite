import fsp from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import colors from 'picocolors'
import { CLIENT_DIR } from '../constants'
import { createDebugger, normalizePath } from '../utils'
import { isCSSRequest } from '../plugins/css'
import { getAffectedGlobModules } from '../plugins/importMetaGlob'
import { isExplicitImportRequired } from '../plugins/importAnalysis'
import { getEnvFilesForMode } from '../env'
import { withTrailingSlash, wrapId } from '../../shared/utils'
import { restartServerWithUrls } from '.'
export const debugHmr = createDebugger('vite:hmr')
const whitespaceRE = /\s/
const normalizedClientDir = normalizePath(CLIENT_DIR)
export function getShortName(file, root) {
  return file.startsWith(withTrailingSlash(root))
    ? path.posix.relative(root, file)
    : file
}
export async function handleHMRUpdate(type, file, server) {
  const { hot, config, moduleGraph } = server
  const shortFile = getShortName(file, config.root)
  const isConfig = file === config.configFile
  const isConfigDependency = config.configFileDependencies.some(
    (name) => file === name,
  )
  const isEnv =
    config.inlineConfig.envFile !== false &&
    getEnvFilesForMode(config.mode, config.envDir).includes(file)
  if (isConfig || isConfigDependency || isEnv) {
    // auto restart server
    debugHmr?.(`[config change] ${colors.dim(shortFile)}`)
    config.logger.info(
      colors.green(
        `${normalizePath(path.relative(process.cwd(), file))} changed, restarting server...`,
      ),
      { clear: true, timestamp: true },
    )
    try {
      await restartServerWithUrls(server)
    } catch (e) {
      config.logger.error(colors.red(e))
    }
    return
  }
  debugHmr?.(`[file change] ${colors.dim(shortFile)}`)
  // (dev only) the client itself cannot be hot updated.
  if (file.startsWith(withTrailingSlash(normalizedClientDir))) {
    hot.send({
      type: 'full-reload',
      path: '*',
      triggeredBy: path.resolve(config.root, file),
    })
    return
  }
  const mods = new Set(moduleGraph.getModulesByFile(file))
  if (type === 'create') {
    for (const mod of moduleGraph._hasResolveFailedErrorModules) {
      mods.add(mod)
    }
  }
  if (type === 'create' || type === 'delete') {
    for (const mod of getAffectedGlobModules(file, server)) {
      mods.add(mod)
    }
  }
  // check if any plugin wants to perform custom HMR handling
  const timestamp = Date.now()
  const hmrContext = {
    file,
    timestamp,
    modules: [...mods],
    read: () => readModifiedFile(file),
    server,
  }
  if (type === 'update') {
    for (const hook of config.getSortedPluginHooks('handleHotUpdate')) {
      const filteredModules = await hook(hmrContext)
      if (filteredModules) {
        hmrContext.modules = filteredModules
      }
    }
  }
  if (!hmrContext.modules.length) {
    // html file cannot be hot updated
    if (file.endsWith('.html')) {
      config.logger.info(colors.green(`page reload `) + colors.dim(shortFile), {
        clear: true,
        timestamp: true,
      })
      hot.send({
        type: 'full-reload',
        path: config.server.middlewareMode
          ? '*'
          : '/' + normalizePath(path.relative(config.root, file)),
      })
    } else {
      // loaded but not in the module graph, probably not js
      debugHmr?.(`[no modules matched] ${colors.dim(shortFile)}`)
    }
    return
  }
  updateModules(shortFile, hmrContext.modules, timestamp, server)
}
export function updateModules(
  file,
  modules,
  timestamp,
  { config, hot, moduleGraph },
  afterInvalidation,
) {
  const updates = []
  const invalidatedModules = new Set()
  const traversedModules = new Set()
  // Modules could be empty if a root module is invalidated via import.meta.hot.invalidate()
  let needFullReload = modules.length === 0
  for (const mod of modules) {
    const boundaries = []
    const hasDeadEnd = propagateUpdate(mod, traversedModules, boundaries)
    moduleGraph.invalidateModule(mod, invalidatedModules, timestamp, true)
    if (needFullReload) {
      continue
    }
    if (hasDeadEnd) {
      needFullReload = hasDeadEnd
      continue
    }
    updates.push(
      ...boundaries.map(
        ({ boundary, acceptedVia, isWithinCircularImport }) => ({
          type: `${boundary.type}-update`,
          timestamp,
          path: normalizeHmrUrl(boundary.url),
          acceptedPath: normalizeHmrUrl(acceptedVia.url),
          explicitImportRequired:
            boundary.type === 'js'
              ? isExplicitImportRequired(acceptedVia.url)
              : false,
          isWithinCircularImport,
          // browser modules are invalidated by changing ?t= query,
          // but in ssr we control the module system, so we can directly remove them form cache
          ssrInvalidates: getSSRInvalidatedImporters(acceptedVia),
        }),
      ),
    )
  }
  if (needFullReload) {
    const reason =
      typeof needFullReload === 'string'
        ? colors.dim(` (${needFullReload})`)
        : ''
    config.logger.info(
      colors.green(`page reload `) + colors.dim(file) + reason,
      { clear: !afterInvalidation, timestamp: true },
    )
    hot.send({
      type: 'full-reload',
      triggeredBy: path.resolve(config.root, file),
    })
    return
  }
  if (updates.length === 0) {
    debugHmr?.(colors.yellow(`no update happened `) + colors.dim(file))
    return
  }
  config.logger.info(
    colors.green(`hmr update `) +
      colors.dim([...new Set(updates.map((u) => u.path))].join(', ')),
    { clear: !afterInvalidation, timestamp: true },
  )
  hot.send({
    type: 'update',
    updates,
  })
}
function populateSSRImporters(module, timestamp, seen = new Set()) {
  module.ssrImportedModules.forEach((importer) => {
    if (seen.has(importer)) {
      return
    }
    if (
      importer.lastHMRTimestamp === timestamp ||
      importer.lastInvalidationTimestamp === timestamp
    ) {
      seen.add(importer)
      populateSSRImporters(importer, timestamp, seen)
    }
  })
  return seen
}
function getSSRInvalidatedImporters(module) {
  return [...populateSSRImporters(module, module.lastHMRTimestamp)].map(
    (m) => m.file,
  )
}
function areAllImportsAccepted(importedBindings, acceptedExports) {
  for (const binding of importedBindings) {
    if (!acceptedExports.has(binding)) {
      return false
    }
  }
  return true
}
function propagateUpdate(
  node,
  traversedModules,
  boundaries,
  currentChain = [node],
) {
  if (traversedModules.has(node)) {
    return false
  }
  traversedModules.add(node)
  // #7561
  // if the imports of `node` have not been analyzed, then `node` has not
  // been loaded in the browser and we should stop propagation.
  if (node.id && node.isSelfAccepting === undefined) {
    debugHmr?.(
      `[propagate update] stop propagation because not analyzed: ${colors.dim(node.id)}`,
    )
    return false
  }
  if (node.isSelfAccepting) {
    boundaries.push({
      boundary: node,
      acceptedVia: node,
      isWithinCircularImport: isNodeWithinCircularImports(node, currentChain),
    })
    // additionally check for CSS importers, since a PostCSS plugin like
    // Tailwind JIT may register any file as a dependency to a CSS file.
    for (const importer of node.importers) {
      if (isCSSRequest(importer.url) && !currentChain.includes(importer)) {
        propagateUpdate(
          importer,
          traversedModules,
          boundaries,
          currentChain.concat(importer),
        )
      }
    }
    return false
  }
  // A partially accepted module with no importers is considered self accepting,
  // because the deal is "there are parts of myself I can't self accept if they
  // are used outside of me".
  // Also, the imported module (this one) must be updated before the importers,
  // so that they do get the fresh imported module when/if they are reloaded.
  if (node.acceptedHmrExports) {
    boundaries.push({
      boundary: node,
      acceptedVia: node,
      isWithinCircularImport: isNodeWithinCircularImports(node, currentChain),
    })
  } else {
    if (!node.importers.size) {
      return true
    }
    // #3716, #3913
    // For a non-CSS file, if all of its importers are CSS files (registered via
    // PostCSS plugins) it should be considered a dead end and force full reload.
    if (
      !isCSSRequest(node.url) &&
      [...node.importers].every((i) => isCSSRequest(i.url))
    ) {
      return true
    }
  }
  for (const importer of node.importers) {
    const subChain = currentChain.concat(importer)
    if (importer.acceptedHmrDeps.has(node)) {
      boundaries.push({
        boundary: importer,
        acceptedVia: node,
        isWithinCircularImport: isNodeWithinCircularImports(importer, subChain),
      })
      continue
    }
    if (node.id && node.acceptedHmrExports && importer.importedBindings) {
      const importedBindingsFromNode = importer.importedBindings.get(node.id)
      if (
        importedBindingsFromNode &&
        areAllImportsAccepted(importedBindingsFromNode, node.acceptedHmrExports)
      ) {
        continue
      }
    }
    if (
      !currentChain.includes(importer) &&
      propagateUpdate(importer, traversedModules, boundaries, subChain)
    ) {
      return true
    }
  }
  return false
}
/**
 * Check importers recursively if it's an import loop. An accepted module within
 * an import loop cannot recover its execution order and should be reloaded.
 *
 * @param node The node that accepts HMR and is a boundary
 * @param nodeChain The chain of nodes/imports that lead to the node.
 *   (The last node in the chain imports the `node` parameter)
 * @param currentChain The current chain tracked from the `node` parameter
 * @param traversedModules The set of modules that have traversed
 */
function isNodeWithinCircularImports(
  node,
  nodeChain,
  currentChain = [node],
  traversedModules = new Set(),
) {
  // To help visualize how each parameters work, imagine this import graph:
  //
  // A -> B -> C -> ACCEPTED -> D -> E -> NODE
  //      ^--------------------------|
  //
  // ACCEPTED: the node that accepts HMR. the `node` parameter.
  // NODE    : the initial node that triggered this HMR.
  //
  // This function will return true in the above graph, which:
  // `node`         : ACCEPTED
  // `nodeChain`    : [NODE, E, D, ACCEPTED]
  // `currentChain` : [ACCEPTED, C, B]
  //
  // It works by checking if any `node` importers are within `nodeChain`, which
  // means there's an import loop with a HMR-accepted module in it.
  if (traversedModules.has(node)) {
    return false
  }
  traversedModules.add(node)
  for (const importer of node.importers) {
    // Node may import itself which is safe
    if (importer === node) continue
    // a PostCSS plugin like Tailwind JIT may register
    // any file as a dependency to a CSS file.
    // But in that case, the actual dependency chain is separate.
    if (isCSSRequest(importer.url)) continue
    // Check circular imports
    const importerIndex = nodeChain.indexOf(importer)
    if (importerIndex > -1) {
      // Log extra debug information so users can fix and remove the circular imports
      if (debugHmr) {
        // Following explanation above:
        // `importer`                    : E
        // `currentChain` reversed       : [B, C, ACCEPTED]
        // `nodeChain` sliced & reversed : [D, E]
        // Combined                      : [E, B, C, ACCEPTED, D, E]
        const importChain = [
          importer,
          ...[...currentChain].reverse(),
          ...nodeChain.slice(importerIndex, -1).reverse(),
        ]
        debugHmr(
          colors.yellow(`circular imports detected: `) +
            importChain.map((m) => colors.dim(m.url)).join(' -> '),
        )
      }
      return true
    }
    // Continue recursively
    if (!currentChain.includes(importer)) {
      const result = isNodeWithinCircularImports(
        importer,
        nodeChain,
        currentChain.concat(importer),
        traversedModules,
      )
      if (result) return result
    }
  }
  return false
}
export function handlePrunedModules(mods, { hot }) {
  // update the disposed modules' hmr timestamp
  // since if it's re-imported, it should re-apply side effects
  // and without the timestamp the browser will not re-import it!
  const t = Date.now()
  mods.forEach((mod) => {
    mod.lastHMRTimestamp = t
    mod.lastHMRInvalidationReceived = false
    debugHmr?.(`[dispose] ${colors.dim(mod.file)}`)
  })
  hot.send({
    type: 'prune',
    paths: [...mods].map((m) => m.url),
  })
}
/**
 * Lex import.meta.hot.accept() for accepted deps.
 * Since hot.accept() can only accept string literals or array of string
 * literals, we don't really need a heavy @babel/parse call on the entire source.
 *
 * @returns selfAccepts
 */
export function lexAcceptedHmrDeps(code, start, urls) {
  let state = 0 /* LexerState.inCall */
  // the state can only be 2 levels deep so no need for a stack
  let prevState = 0 /* LexerState.inCall */
  let currentDep = ''
  function addDep(index) {
    urls.add({
      url: currentDep,
      start: index - currentDep.length - 1,
      end: index + 1,
    })
    currentDep = ''
  }
  for (let i = start; i < code.length; i++) {
    const char = code.charAt(i)
    switch (state) {
      case 0 /* LexerState.inCall */:
      case 4 /* LexerState.inArray */:
        if (char === `'`) {
          prevState = state
          state = 1 /* LexerState.inSingleQuoteString */
        } else if (char === `"`) {
          prevState = state
          state = 2 /* LexerState.inDoubleQuoteString */
        } else if (char === '`') {
          prevState = state
          state = 3 /* LexerState.inTemplateString */
        } else if (whitespaceRE.test(char)) {
          continue
        } else {
          if (state === 0 /* LexerState.inCall */) {
            if (char === `[`) {
              state = 4 /* LexerState.inArray */
            } else {
              // reaching here means the first arg is neither a string literal
              // nor an Array literal (direct callback) or there is no arg
              // in both case this indicates a self-accepting module
              return true // done
            }
          } else if (state === 4 /* LexerState.inArray */) {
            if (char === `]`) {
              return false // done
            } else if (char === ',') {
              continue
            } else {
              error(i)
            }
          }
        }
        break
      case 1 /* LexerState.inSingleQuoteString */:
        if (char === `'`) {
          addDep(i)
          if (prevState === 0 /* LexerState.inCall */) {
            // accept('foo', ...)
            return false
          } else {
            state = prevState
          }
        } else {
          currentDep += char
        }
        break
      case 2 /* LexerState.inDoubleQuoteString */:
        if (char === `"`) {
          addDep(i)
          if (prevState === 0 /* LexerState.inCall */) {
            // accept('foo', ...)
            return false
          } else {
            state = prevState
          }
        } else {
          currentDep += char
        }
        break
      case 3 /* LexerState.inTemplateString */:
        if (char === '`') {
          addDep(i)
          if (prevState === 0 /* LexerState.inCall */) {
            // accept('foo', ...)
            return false
          } else {
            state = prevState
          }
        } else if (char === '$' && code.charAt(i + 1) === '{') {
          error(i)
        } else {
          currentDep += char
        }
        break
      default:
        throw new Error('unknown import.meta.hot lexer state')
    }
  }
  return false
}
export function lexAcceptedHmrExports(code, start, exportNames) {
  const urls = new Set()
  lexAcceptedHmrDeps(code, start, urls)
  for (const { url } of urls) {
    exportNames.add(url)
  }
  return urls.size > 0
}
export function normalizeHmrUrl(url) {
  if (url[0] !== '.' && url[0] !== '/') {
    url = wrapId(url)
  }
  return url
}
function error(pos) {
  const err = new Error(
    `import.meta.hot.accept() can only accept string literals or an ` +
      `Array of string literals.`,
  )
  err.pos = pos
  throw err
}
// vitejs/vite#610 when hot-reloading Vue files, we read immediately on file
// change event and sometimes this can be too early and get an empty buffer.
// Poll until the file's modified time has changed before reading again.
async function readModifiedFile(file) {
  const content = await fsp.readFile(file, 'utf-8')
  if (!content) {
    const mtime = (await fsp.stat(file)).mtimeMs
    for (let n = 0; n < 10; n++) {
      await new Promise((r) => setTimeout(r, 10))
      const newMtime = (await fsp.stat(file)).mtimeMs
      if (newMtime !== mtime) {
        break
      }
    }
    return await fsp.readFile(file, 'utf-8')
  } else {
    return content
  }
}
export function createHMRBroadcaster() {
  const channels = []
  const readyChannels = new WeakSet()
  const broadcaster = {
    get channels() {
      return [...channels]
    },
    addChannel(channel) {
      if (channels.some((c) => c.name === channel.name)) {
        throw new Error(`HMR channel "${channel.name}" is already defined.`)
      }
      channels.push(channel)
      return broadcaster
    },
    on(event, listener) {
      // emit connection event only when all channels are ready
      if (event === 'connection') {
        // make a copy so we don't wait for channels that might be added after this is triggered
        const channels = this.channels
        channels.forEach((channel) =>
          channel.on('connection', () => {
            readyChannels.add(channel)
            if (channels.every((c) => readyChannels.has(c))) {
              listener()
            }
          }),
        )
        return
      }
      channels.forEach((channel) => channel.on(event, listener))
      return
    },
    off(event, listener) {
      channels.forEach((channel) => channel.off(event, listener))
      return
    },
    send(...args) {
      channels.forEach((channel) => channel.send(...args))
    },
    listen() {
      channels.forEach((channel) => channel.listen())
    },
    close() {
      return Promise.all(channels.map((channel) => channel.close()))
    },
  }
  return broadcaster
}
export function createServerHMRChannel() {
  const innerEmitter = new EventEmitter()
  const outsideEmitter = new EventEmitter()
  return {
    name: 'ssr',
    send(...args) {
      let payload
      if (typeof args[0] === 'string') {
        payload = {
          type: 'custom',
          event: args[0],
          data: args[1],
        }
      } else {
        payload = args[0]
      }
      outsideEmitter.emit('send', payload)
    },
    off(event, listener) {
      innerEmitter.off(event, listener)
    },
    on: (event, listener) => {
      innerEmitter.on(event, listener)
    },
    close() {
      innerEmitter.removeAllListeners()
      outsideEmitter.removeAllListeners()
    },
    listen() {
      innerEmitter.emit('connection')
    },
    api: {
      innerEmitter,
      outsideEmitter,
    },
  }
}
