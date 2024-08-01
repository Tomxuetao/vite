import { Worker } from 'artichokie'
import { requireResolveFromRootWithFallback } from '../utils'
let terserPath
const loadTerserPath = (root) => {
  if (terserPath) return terserPath
  try {
    terserPath = requireResolveFromRootWithFallback(root, 'terser')
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'terser not found. Since Vite v3, terser has become an optional dependency. You need to install it.',
      )
    } else {
      const message = new Error(`terser failed to load:\n${e.message}`)
      message.stack = e.stack + '\n' + message.stack
      throw message
    }
  }
  return terserPath
}
export function terserPlugin(config) {
  const { maxWorkers, ...terserOptions } = config.build.terserOptions
  const makeWorker = () =>
    new Worker(
      () => async (terserPath, code, options) => {
        // test fails when using `import`. maybe related: https://github.com/nodejs/node/issues/43205
        // eslint-disable-next-line no-restricted-globals -- this function runs inside cjs
        const terser = require(terserPath)
        return terser.minify(code, options)
      },
      {
        max: maxWorkers,
      },
    )
  let worker
  return {
    name: 'vite:terser',
    async renderChunk(code, _chunk, outputOptions) {
      // This plugin is included for any non-false value of config.build.minify,
      // so that normal chunks can use the preferred minifier, and legacy chunks
      // can use terser.
      if (
        config.build.minify !== 'terser' &&
        // @ts-expect-error injected by @vitejs/plugin-legacy
        !outputOptions.__vite_force_terser__
      ) {
        return null
      }
      // Do not minify ES lib output since that would remove pure annotations
      // and break tree-shaking.
      if (config.build.lib && outputOptions.format === 'es') {
        return null
      }
      // Lazy load worker.
      worker ||= makeWorker()
      const terserPath = loadTerserPath(config.root)
      const res = await worker.run(terserPath, code, {
        safari10: true,
        ...terserOptions,
        sourceMap: !!outputOptions.sourcemap,
        module: outputOptions.format.startsWith('es'),
        toplevel: outputOptions.format === 'cjs',
      })
      return {
        code: res.code,
        map: res.map,
      }
    },
    closeBundle() {
      worker?.stop()
    },
  }
}
