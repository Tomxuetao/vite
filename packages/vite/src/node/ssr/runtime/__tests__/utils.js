import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, test } from 'vitest'
import { createServer } from '../../../server'
import { createViteRuntime } from '../mainThreadRuntime'
export async function createViteRuntimeTester(config = {}, runtimeConfig = {}) {
  function waitForWatcher(server) {
    return new Promise((resolve) => {
      if (server.watcher._readyEmitted) {
        resolve()
      } else {
        server.watcher.once('ready', () => resolve())
      }
    })
  }
  beforeEach(async (t) => {
    globalThis.__HMR__ = {}
    t.server = await createServer({
      root: __dirname,
      logLevel: 'error',
      server: {
        middlewareMode: true,
        watch: null,
        ws: false,
      },
      ssr: {
        external: ['@vitejs/cjs-external', '@vitejs/esm-external'],
      },
      optimizeDeps: {
        disabled: true,
        noDiscovery: true,
        include: [],
      },
      plugins: [
        {
          name: 'vite-plugin-virtual',
          resolveId(id) {
            if (id === 'virtual0:test') {
              return `\0virtual:test`
            }
            if (id === 'virtual:test') {
              return 'virtual:test'
            }
          },
          load(id) {
            if (id === `\0virtual:test`) {
              return `export const msg = 'virtual0'`
            }
            if (id === `virtual:test`) {
              return `export const msg = 'virtual'`
            }
          },
        },
      ],
      ...config,
    })
    t.runtime = await createViteRuntime(t.server, {
      hmr: {
        logger: false,
      },
      // don't override by default so Vitest source maps are correct
      sourcemapInterceptor: false,
      ...runtimeConfig,
    })
    if (config.server?.watch) {
      await waitForWatcher(t.server)
    }
  })
  afterEach(async (t) => {
    await t.runtime.destroy()
    await t.server.close()
  })
  return test
}
const originalFiles = new Map()
const createdFiles = new Set()
afterEach(() => {
  originalFiles.forEach((content, file) => {
    fs.writeFileSync(file, content, 'utf-8')
  })
  createdFiles.forEach((file) => {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  })
  originalFiles.clear()
  createdFiles.clear()
})
export function createFile(file, content) {
  createdFiles.add(file)
  fs.mkdirSync(dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf-8')
}
export function editFile(file, callback) {
  const content = fs.readFileSync(file, 'utf-8')
  if (!originalFiles.has(file)) originalFiles.set(file, content)
  fs.writeFileSync(file, callback(content), 'utf-8')
}
export function resolvePath(baseUrl, path) {
  const filename = fileURLToPath(baseUrl)
  return resolve(dirname(filename), path).replace(/\\/g, '/')
}
