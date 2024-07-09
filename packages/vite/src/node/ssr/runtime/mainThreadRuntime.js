import { existsSync, readFileSync } from 'node:fs'
import { ESModulesRunner, ViteRuntime } from 'vite/runtime'
import { ServerHMRConnector } from './serverHmrConnector'
function createHMROptions(server, options) {
  if (server.config.server.hmr === false || options.hmr === false) {
    return false
  }
  const connection = new ServerHMRConnector(server)
  return {
    connection,
    logger: options.hmr?.logger,
  }
}
const prepareStackTrace = {
  retrieveFile(id) {
    if (existsSync(id)) {
      return readFileSync(id, 'utf-8')
    }
  },
}
function resolveSourceMapOptions(options) {
  if (options.sourcemapInterceptor != null) {
    if (options.sourcemapInterceptor === 'prepareStackTrace') {
      return prepareStackTrace
    }
    if (typeof options.sourcemapInterceptor === 'object') {
      return { ...prepareStackTrace, ...options.sourcemapInterceptor }
    }
    return options.sourcemapInterceptor
  }
  if (typeof process !== 'undefined' && 'setSourceMapsEnabled' in process) {
    return 'node'
  }
  return prepareStackTrace
}
/**
 * Create an instance of the Vite SSR runtime that support HMR.
 * @experimental
 */
export async function createViteRuntime(server, options = {}) {
  const hmr = createHMROptions(server, options)
  return new ViteRuntime(
    {
      ...options,
      root: server.config.root,
      fetchModule: server.ssrFetchModule,
      hmr,
      sourcemapInterceptor: resolveSourceMapOptions(options),
    },
    options.runner || new ESModulesRunner(),
  )
}
