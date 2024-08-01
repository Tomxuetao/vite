import fs from 'node:fs'
import path from 'node:path'
import colors from 'picocolors'
import commonjsPlugin from '@rollup/plugin-commonjs'
import { withTrailingSlash } from '../shared/utils'
import {
  DEFAULT_ASSETS_INLINE_LIMIT,
  ESBUILD_MODULES_TARGET,
  VERSION,
} from './constants'
import { resolveConfig } from './config'
import { buildReporterPlugin } from './plugins/reporter'
import { buildEsbuildPlugin } from './plugins/esbuild'
import { terserPlugin } from './plugins/terser'
import {
  arraify,
  asyncFlatten,
  copyDir,
  displayTime,
  emptyDir,
  joinUrlSegments,
  normalizePath,
  partialEncodeURIPath,
  requireResolveFromRootWithFallback,
} from './utils'
import { manifestPlugin } from './plugins/manifest'
import { dataURIPlugin } from './plugins/dataUri'
import { buildImportAnalysisPlugin } from './plugins/importAnalysisBuild'
import { ssrManifestPlugin } from './ssr/ssrManifestPlugin'
import { loadFallbackPlugin } from './plugins/loadFallback'
import { findNearestPackageData } from './packages'
import {
  getResolvedOutDirs,
  resolveChokidarOptions,
  resolveEmptyOutDir,
} from './watch'
import { completeSystemWrapPlugin } from './plugins/completeSystemWrap'
import { mergeConfig } from './publicUtils'
import { webWorkerPostPlugin } from './plugins/worker'
import { getHookHandler } from './plugins'
export function resolveBuildOptions(raw, logger, root) {
  const deprecatedPolyfillModulePreload = raw?.polyfillModulePreload
  if (raw) {
    const { polyfillModulePreload, ...rest } = raw
    raw = rest
    if (deprecatedPolyfillModulePreload !== undefined) {
      logger.warn(
        'polyfillModulePreload is deprecated. Use modulePreload.polyfill instead.',
      )
    }
    if (
      deprecatedPolyfillModulePreload === false &&
      raw.modulePreload === undefined
    ) {
      raw.modulePreload = { polyfill: false }
    }
  }
  const modulePreload = raw?.modulePreload
  const defaultModulePreload = {
    polyfill: true,
  }
  const defaultBuildOptions = {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: DEFAULT_ASSETS_INLINE_LIMIT,
    cssCodeSplit: !raw?.lib,
    sourcemap: false,
    rollupOptions: {},
    minify: raw?.ssr ? false : 'esbuild',
    terserOptions: {},
    write: true,
    emptyOutDir: null,
    copyPublicDir: true,
    manifest: false,
    lib: false,
    ssr: false,
    ssrManifest: false,
    ssrEmitAssets: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    watch: null,
  }
  const userBuildOptions = raw
    ? mergeConfig(defaultBuildOptions, raw)
    : defaultBuildOptions
  // @ts-expect-error Fallback options instead of merging
  const resolved = {
    target: 'modules',
    cssTarget: false,
    ...userBuildOptions,
    commonjsOptions: {
      include: [/node_modules/],
      extensions: ['.js', '.cjs'],
      ...userBuildOptions.commonjsOptions,
    },
    dynamicImportVarsOptions: {
      warnOnError: true,
      exclude: [/node_modules/],
      ...userBuildOptions.dynamicImportVarsOptions,
    },
    // Resolve to false | object
    modulePreload:
      modulePreload === false
        ? false
        : typeof modulePreload === 'object'
          ? {
              ...defaultModulePreload,
              ...modulePreload,
            }
          : defaultModulePreload,
  }
  // handle special build targets
  if (resolved.target === 'modules') {
    resolved.target = ESBUILD_MODULES_TARGET
  } else if (resolved.target === 'esnext' && resolved.minify === 'terser') {
    try {
      const terserPackageJsonPath = requireResolveFromRootWithFallback(
        root,
        'terser/package.json',
      )
      const terserPackageJson = JSON.parse(
        fs.readFileSync(terserPackageJsonPath, 'utf-8'),
      )
      const v = terserPackageJson.version.split('.')
      if (v[0] === '5' && v[1] < 16) {
        // esnext + terser 5.16<: limit to es2021 so it can be minified by terser
        resolved.target = 'es2021'
      }
    } catch {}
  }
  if (!resolved.cssTarget) {
    resolved.cssTarget = resolved.target
  }
  // normalize false string into actual false
  if (resolved.minify === 'false') {
    resolved.minify = false
  } else if (resolved.minify === true) {
    resolved.minify = 'esbuild'
  }
  if (resolved.cssMinify == null) {
    resolved.cssMinify = !!resolved.minify
  }
  return resolved
}
export async function resolveBuildPlugins(config) {
  const options = config.build
  const { commonjsOptions } = options
  const usePluginCommonjs =
    !Array.isArray(commonjsOptions?.include) ||
    commonjsOptions?.include.length !== 0
  const rollupOptionsPlugins = options.rollupOptions.plugins
  return {
    pre: [
      completeSystemWrapPlugin(),
      ...(usePluginCommonjs ? [commonjsPlugin(options.commonjsOptions)] : []),
      dataURIPlugin(),
      ...(await asyncFlatten(arraify(rollupOptionsPlugins))).filter(Boolean),
      ...(config.isWorker ? [webWorkerPostPlugin()] : []),
    ],
    post: [
      buildImportAnalysisPlugin(config),
      ...(config.esbuild !== false ? [buildEsbuildPlugin(config)] : []),
      ...(options.minify ? [terserPlugin(config)] : []),
      ...(!config.isWorker
        ? [
            ...(options.manifest ? [manifestPlugin(config)] : []),
            ...(options.ssrManifest ? [ssrManifestPlugin(config)] : []),
            buildReporterPlugin(config),
          ]
        : []),
      loadFallbackPlugin(),
    ],
  }
}
/**
 * Bundles the app for production.
 * Returns a Promise containing the build result.
 */
export async function build(inlineConfig = {}) {
  const config = await resolveConfig(
    inlineConfig,
    'build',
    'production',
    'production',
  )
  const options = config.build
  const ssr = !!options.ssr
  const libOptions = options.lib
  config.logger.info(
    colors.cyan(
      `vite v${VERSION} ${colors.green(`building ${ssr ? `SSR bundle ` : ``}for ${config.mode}...`)}`,
    ),
  )
  const resolve = (p) => path.resolve(config.root, p)
  const input = libOptions
    ? options.rollupOptions?.input ||
      (typeof libOptions.entry === 'string'
        ? resolve(libOptions.entry)
        : Array.isArray(libOptions.entry)
          ? libOptions.entry.map(resolve)
          : Object.fromEntries(
              Object.entries(libOptions.entry).map(([alias, file]) => [
                alias,
                resolve(file),
              ]),
            ))
    : typeof options.ssr === 'string'
      ? resolve(options.ssr)
      : options.rollupOptions?.input || resolve('index.html')
  if (ssr && typeof input === 'string' && input.endsWith('.html')) {
    throw new Error(
      `rollupOptions.input should not be an html file when building for SSR. ` +
        `Please specify a dedicated SSR entry.`,
    )
  }
  if (config.build.cssCodeSplit === false) {
    const inputs =
      typeof input === 'string'
        ? [input]
        : Array.isArray(input)
          ? input
          : Object.values(input)
    if (inputs.some((input) => input.endsWith('.css'))) {
      throw new Error(
        `When "build.cssCodeSplit: false" is set, "rollupOptions.input" should not include CSS files.`,
      )
    }
  }
  const outDir = resolve(options.outDir)
  // inject ssr arg to plugin load/transform hooks
  const plugins = ssr
    ? config.plugins.map((p) => injectSsrFlagToHooks(p))
    : config.plugins
  const rollupOptions = {
    preserveEntrySignatures: ssr
      ? 'allow-extension'
      : libOptions
        ? 'strict'
        : false,
    cache: config.build.watch ? undefined : false,
    ...options.rollupOptions,
    input,
    plugins,
    external: options.rollupOptions?.external,
    onwarn(warning, warn) {
      onRollupWarning(warning, warn, config)
    },
  }
  /**
   * The stack string usually contains a copy of the message at the start of the stack.
   * If the stack starts with the message, we remove it and just return the stack trace
   * portion. Otherwise the original stack trace is used.
   */
  function extractStack(e) {
    const { stack, name = 'Error', message } = e
    // If we don't have a stack, not much we can do.
    if (!stack) {
      return stack
    }
    const expectedPrefix = `${name}: ${message}\n`
    if (stack.startsWith(expectedPrefix)) {
      return stack.slice(expectedPrefix.length)
    }
    return stack
  }
  /**
   * Esbuild code frames have newlines at the start and end of the frame, rollup doesn't
   * This function normalizes the frame to match the esbuild format which has more pleasing padding
   */
  const normalizeCodeFrame = (frame) => {
    const trimmedPadding = frame.replace(/^\n|\n$/g, '')
    return `\n${trimmedPadding}\n`
  }
  const enhanceRollupError = (e) => {
    const stackOnly = extractStack(e)
    let msg = colors.red((e.plugin ? `[${e.plugin}] ` : '') + e.message)
    if (e.id) {
      msg += `\nfile: ${colors.cyan(e.id + (e.loc ? `:${e.loc.line}:${e.loc.column}` : ''))}`
    }
    if (e.frame) {
      msg += `\n` + colors.yellow(normalizeCodeFrame(e.frame))
    }
    e.message = msg
    // We are rebuilding the stack trace to include the more detailed message at the top.
    // Previously this code was relying on mutating e.message changing the generated stack
    // when it was accessed, but we don't have any guarantees that the error we are working
    // with hasn't already had its stack accessed before we get here.
    if (stackOnly !== undefined) {
      e.stack = `${e.message}\n${stackOnly}`
    }
  }
  const outputBuildError = (e) => {
    enhanceRollupError(e)
    clearLine()
    config.logger.error(e.message, { error: e })
  }
  let bundle
  let startTime
  try {
    const buildOutputOptions = (output = {}) => {
      // @ts-expect-error See https://github.com/vitejs/vite/issues/5812#issuecomment-984345618
      if (output.output) {
        config.logger.warn(
          `You've set "rollupOptions.output.output" in your config. ` +
            `This is deprecated and will override all Vite.js default output options. ` +
            `Please use "rollupOptions.output" instead.`,
        )
      }
      if (output.file) {
        throw new Error(
          `Vite does not support "rollupOptions.output.file". ` +
            `Please use "rollupOptions.output.dir" and "rollupOptions.output.entryFileNames" instead.`,
        )
      }
      if (output.sourcemap) {
        config.logger.warnOnce(
          colors.yellow(
            `Vite does not support "rollupOptions.output.sourcemap". ` +
              `Please use "build.sourcemap" instead.`,
          ),
        )
      }
      const ssrNodeBuild = ssr && config.ssr.target === 'node'
      const ssrWorkerBuild = ssr && config.ssr.target === 'webworker'
      const format = output.format || 'es'
      const jsExt =
        ssrNodeBuild || libOptions
          ? resolveOutputJsExtension(
              format,
              findNearestPackageData(config.root, config.packageCache)?.data
                .type,
            )
          : 'js'
      return {
        dir: outDir,
        // Default format is 'es' for regular and for SSR builds
        format,
        exports: 'auto',
        sourcemap: options.sourcemap,
        name: libOptions ? libOptions.name : undefined,
        hoistTransitiveImports: libOptions ? false : undefined,
        // es2015 enables `generatedCode.symbols`
        // - #764 add `Symbol.toStringTag` when build es module into cjs chunk
        // - #1048 add `Symbol.toStringTag` for module default export
        generatedCode: 'es2015',
        entryFileNames: ssr
          ? `[name].${jsExt}`
          : libOptions
            ? ({ name }) =>
                resolveLibFilename(
                  libOptions,
                  format,
                  name,
                  config.root,
                  jsExt,
                  config.packageCache,
                )
            : path.posix.join(options.assetsDir, `[name]-[hash].${jsExt}`),
        chunkFileNames: libOptions
          ? `[name]-[hash].${jsExt}`
          : path.posix.join(options.assetsDir, `[name]-[hash].${jsExt}`),
        assetFileNames: libOptions
          ? `[name].[ext]`
          : path.posix.join(options.assetsDir, `[name]-[hash].[ext]`),
        inlineDynamicImports:
          output.format === 'umd' ||
          output.format === 'iife' ||
          (ssrWorkerBuild &&
            (typeof input === 'string' || Object.keys(input).length === 1)),
        ...output,
      }
    }
    // resolve lib mode outputs
    const outputs = resolveBuildOutputs(
      options.rollupOptions?.output,
      libOptions,
      config.logger,
    )
    const normalizedOutputs = []
    if (Array.isArray(outputs)) {
      for (const resolvedOutput of outputs) {
        normalizedOutputs.push(buildOutputOptions(resolvedOutput))
      }
    } else {
      normalizedOutputs.push(buildOutputOptions(outputs))
    }
    const resolvedOutDirs = getResolvedOutDirs(
      config.root,
      options.outDir,
      options.rollupOptions?.output,
    )
    const emptyOutDir = resolveEmptyOutDir(
      options.emptyOutDir,
      config.root,
      resolvedOutDirs,
      config.logger,
    )
    // watch file changes with rollup
    if (config.build.watch) {
      config.logger.info(colors.cyan(`\nwatching for file changes...`))
      const resolvedChokidarOptions = resolveChokidarOptions(
        config,
        config.build.watch.chokidar,
        resolvedOutDirs,
        emptyOutDir,
      )
      const { watch } = await import('rollup')
      const watcher = watch({
        ...rollupOptions,
        output: normalizedOutputs,
        watch: {
          ...config.build.watch,
          chokidar: resolvedChokidarOptions,
        },
      })
      watcher.on('event', (event) => {
        if (event.code === 'BUNDLE_START') {
          config.logger.info(colors.cyan(`\nbuild started...`))
          if (options.write) {
            prepareOutDir(resolvedOutDirs, emptyOutDir, config)
          }
        } else if (event.code === 'BUNDLE_END') {
          event.result.close()
          config.logger.info(colors.cyan(`built in ${event.duration}ms.`))
        } else if (event.code === 'ERROR') {
          outputBuildError(event.error)
        }
      })
      return watcher
    }
    // write or generate files with rollup
    const { rollup } = await import('rollup')
    startTime = Date.now()
    bundle = await rollup(rollupOptions)
    if (options.write) {
      prepareOutDir(resolvedOutDirs, emptyOutDir, config)
    }
    const res = []
    for (const output of normalizedOutputs) {
      res.push(await bundle[options.write ? 'write' : 'generate'](output))
    }
    config.logger.info(
      `${colors.green(`✓ built in ${displayTime(Date.now() - startTime)}`)}`,
    )
    return Array.isArray(outputs) ? res : res[0]
  } catch (e) {
    enhanceRollupError(e)
    clearLine()
    if (startTime) {
      config.logger.error(
        `${colors.red('x')} Build failed in ${displayTime(Date.now() - startTime)}`,
      )
      startTime = undefined
    }
    throw e
  } finally {
    if (bundle) await bundle.close()
  }
}
function prepareOutDir(outDirs, emptyOutDir, config) {
  const outDirsArray = [...outDirs]
  for (const outDir of outDirs) {
    if (emptyOutDir !== false && fs.existsSync(outDir)) {
      // skip those other outDirs which are nested in current outDir
      const skipDirs = outDirsArray
        .map((dir) => {
          const relative = path.relative(outDir, dir)
          if (
            relative &&
            !relative.startsWith('..') &&
            !path.isAbsolute(relative)
          ) {
            return relative
          }
          return ''
        })
        .filter(Boolean)
      emptyDir(outDir, [...skipDirs, '.git'])
    }
    if (
      config.build.copyPublicDir &&
      config.publicDir &&
      fs.existsSync(config.publicDir)
    ) {
      if (!areSeparateFolders(outDir, config.publicDir)) {
        config.logger.warn(
          colors.yellow(
            `\n${colors.bold(`(!)`)} The public directory feature may not work correctly. outDir ${colors.white(colors.dim(outDir))} and publicDir ${colors.white(colors.dim(config.publicDir))} are not separate folders.\n`,
          ),
        )
      }
      copyDir(config.publicDir, outDir)
    }
  }
}
function getPkgName(name) {
  return name?.[0] === '@' ? name.split('/')[1] : name
}
function resolveOutputJsExtension(format, type = 'commonjs') {
  if (type === 'module') {
    return format === 'cjs' || format === 'umd' ? 'cjs' : 'js'
  } else {
    return format === 'es' ? 'mjs' : 'js'
  }
}
export function resolveLibFilename(
  libOptions,
  format,
  entryName,
  root,
  extension,
  packageCache,
) {
  if (typeof libOptions.fileName === 'function') {
    return libOptions.fileName(format, entryName)
  }
  const packageJson = findNearestPackageData(root, packageCache)?.data
  const name =
    libOptions.fileName ||
    (packageJson && typeof libOptions.entry === 'string'
      ? getPkgName(packageJson.name)
      : entryName)
  if (!name)
    throw new Error(
      'Name in package.json is required if option "build.lib.fileName" is not provided.',
    )
  extension ??= resolveOutputJsExtension(format, packageJson?.type)
  if (format === 'cjs' || format === 'es') {
    return `${name}.${extension}`
  }
  return `${name}.${format}.${extension}`
}
export function resolveBuildOutputs(outputs, libOptions, logger) {
  if (libOptions) {
    const libHasMultipleEntries =
      typeof libOptions.entry !== 'string' &&
      Object.values(libOptions.entry).length > 1
    const libFormats =
      libOptions.formats ||
      (libHasMultipleEntries ? ['es', 'cjs'] : ['es', 'umd'])
    if (!Array.isArray(outputs)) {
      if (libFormats.includes('umd') || libFormats.includes('iife')) {
        if (libHasMultipleEntries) {
          throw new Error(
            'Multiple entry points are not supported when output formats include "umd" or "iife".',
          )
        }
        if (!libOptions.name) {
          throw new Error(
            'Option "build.lib.name" is required when output formats include "umd" or "iife".',
          )
        }
      }
      return libFormats.map((format) => ({ ...outputs, format }))
    }
    // By this point, we know "outputs" is an Array.
    if (libOptions.formats) {
      logger.warn(
        colors.yellow(
          '"build.lib.formats" will be ignored because "build.rollupOptions.output" is already an array format.',
        ),
      )
    }
    outputs.forEach((output) => {
      if (
        (output.format === 'umd' || output.format === 'iife') &&
        !output.name
      ) {
        throw new Error(
          'Entries in "build.rollupOptions.output" must specify "name" when the format is "umd" or "iife".',
        )
      }
    })
  }
  return outputs
}
const warningIgnoreList = [`CIRCULAR_DEPENDENCY`, `THIS_IS_UNDEFINED`]
const dynamicImportWarningIgnoreList = [
  `Unsupported expression`,
  `statically analyzed`,
]
function clearLine() {
  const tty = process.stdout.isTTY && !process.env.CI
  if (tty) {
    process.stdout.clearLine(0)
    process.stdout.cursorTo(0)
  }
}
export function onRollupWarning(warning, warn, config) {
  const viteWarn = (warnLog) => {
    let warning
    if (typeof warnLog === 'function') {
      warning = warnLog()
    } else {
      warning = warnLog
    }
    if (typeof warning === 'object') {
      if (warning.code === 'UNRESOLVED_IMPORT') {
        const id = warning.id
        const exporter = warning.exporter
        // throw unless it's commonjs external...
        if (!id || !id.endsWith('?commonjs-external')) {
          throw new Error(
            `[vite]: Rollup failed to resolve import "${exporter}" from "${id}".\n` +
              `This is most likely unintended because it can break your application at runtime.\n` +
              `If you do want to externalize this module explicitly add it to\n` +
              `\`build.rollupOptions.external\``,
          )
        }
      }
      if (
        warning.plugin === 'rollup-plugin-dynamic-import-variables' &&
        dynamicImportWarningIgnoreList.some((msg) =>
          warning.message.includes(msg),
        )
      ) {
        return
      }
      if (warningIgnoreList.includes(warning.code)) {
        return
      }
      if (warning.code === 'PLUGIN_WARNING') {
        config.logger.warn(
          `${colors.bold(colors.yellow(`[plugin:${warning.plugin}]`))} ${colors.yellow(warning.message)}`,
        )
        return
      }
    }
    warn(warnLog)
  }
  clearLine()
  const userOnWarn = config.build.rollupOptions?.onwarn
  if (userOnWarn) {
    userOnWarn(warning, viteWarn)
  } else {
    viteWarn(warning)
  }
}
export function resolveUserExternal(user, id, parentId, isResolved) {
  if (typeof user === 'function') {
    return user(id, parentId, isResolved)
  } else if (Array.isArray(user)) {
    return user.some((test) => isExternal(id, test))
  } else {
    return isExternal(id, user)
  }
}
function isExternal(id, test) {
  if (typeof test === 'string') {
    return id === test
  } else {
    return test.test(id)
  }
}
function injectSsrFlagToHooks(plugin) {
  const { resolveId, load, transform } = plugin
  return {
    ...plugin,
    resolveId: wrapSsrResolveId(resolveId),
    load: wrapSsrLoad(load),
    transform: wrapSsrTransform(transform),
  }
}
function wrapSsrResolveId(hook) {
  if (!hook) return
  const fn = getHookHandler(hook)
  const handler = function (id, importer, options) {
    return fn.call(this, id, importer, injectSsrFlag(options))
  }
  if ('handler' in hook) {
    return {
      ...hook,
      handler,
    }
  } else {
    return handler
  }
}
function wrapSsrLoad(hook) {
  if (!hook) return
  const fn = getHookHandler(hook)
  const handler = function (id, ...args) {
    // @ts-expect-error: Receiving options param to be future-proof if Rollup adds it
    return fn.call(this, id, injectSsrFlag(args[0]))
  }
  if ('handler' in hook) {
    return {
      ...hook,
      handler,
    }
  } else {
    return handler
  }
}
function wrapSsrTransform(hook) {
  if (!hook) return
  const fn = getHookHandler(hook)
  const handler = function (code, importer, ...args) {
    // @ts-expect-error: Receiving options param to be future-proof if Rollup adds it
    return fn.call(this, code, importer, injectSsrFlag(args[0]))
  }
  if ('handler' in hook) {
    return {
      ...hook,
      handler,
    }
  } else {
    return handler
  }
}
function injectSsrFlag(options) {
  return { ...(options ?? {}), ssr: true }
}
/*
  The following functions are copied from rollup
  https://github.com/rollup/rollup/blob/ce6cb93098850a46fa242e37b74a919e99a5de28/src/ast/nodes/MetaProperty.ts#L155-L203

  https://github.com/rollup/rollup
  The MIT License (MIT)
  Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors)
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const needsEscapeRegEx = /[\n\r'\\\u2028\u2029]/
const quoteNewlineRegEx = /([\n\r'\u2028\u2029])/g
const backSlashRegEx = /\\/g
function escapeId(id) {
  if (!needsEscapeRegEx.test(id)) return id
  return id.replace(backSlashRegEx, '\\\\').replace(quoteNewlineRegEx, '\\$1')
}
const getResolveUrl = (path, URL = 'URL') => `new ${URL}(${path}).href`
const getRelativeUrlFromDocument = (relativePath, umd = false) =>
  getResolveUrl(
    `'${escapeId(partialEncodeURIPath(relativePath))}', ${umd ? `typeof document === 'undefined' ? location.href : ` : ''}document.currentScript && document.currentScript.src || document.baseURI`,
  )
const getFileUrlFromFullPath = (path) =>
  `require('u' + 'rl').pathToFileURL(${path}).href`
const getFileUrlFromRelativePath = (path) =>
  getFileUrlFromFullPath(`__dirname + '/${escapeId(path)}'`)
const relativeUrlMechanisms = {
  amd: (relativePath) => {
    if (relativePath[0] !== '.') relativePath = './' + relativePath
    return getResolveUrl(
      `require.toUrl('${escapeId(relativePath)}'), document.baseURI`,
    )
  },
  cjs: (relativePath) =>
    `(typeof document === 'undefined' ? ${getFileUrlFromRelativePath(relativePath)} : ${getRelativeUrlFromDocument(relativePath)})`,
  es: (relativePath) =>
    getResolveUrl(
      `'${escapeId(partialEncodeURIPath(relativePath))}', import.meta.url`,
    ),
  iife: (relativePath) => getRelativeUrlFromDocument(relativePath),
  // NOTE: make sure rollup generate `module` params
  system: (relativePath) =>
    getResolveUrl(
      `'${escapeId(partialEncodeURIPath(relativePath))}', module.meta.url`,
    ),
  umd: (relativePath) =>
    `(typeof document === 'undefined' && typeof location === 'undefined' ? ${getFileUrlFromRelativePath(relativePath)} : ${getRelativeUrlFromDocument(relativePath, true)})`,
}
/* end of copy */
const customRelativeUrlMechanisms = {
  ...relativeUrlMechanisms,
  'worker-iife': (relativePath) =>
    getResolveUrl(
      `'${escapeId(partialEncodeURIPath(relativePath))}', self.location.href`,
    ),
}
export function toOutputFilePathInJS(
  filename,
  type,
  hostId,
  hostType,
  config,
  toRelative,
) {
  const { renderBuiltUrl } = config.experimental
  let relative = config.base === '' || config.base === './'
  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId,
      hostType,
      type,
      ssr: !!config.build.ssr,
    })
    if (typeof result === 'object') {
      if (result.runtime) {
        return { runtime: result.runtime }
      }
      if (typeof result.relative === 'boolean') {
        relative = result.relative
      }
    } else if (result) {
      return result
    }
  }
  if (relative && !config.build.ssr) {
    return toRelative(filename, hostId)
  }
  return joinUrlSegments(config.base, filename)
}
export function createToImportMetaURLBasedRelativeRuntime(format, isWorker) {
  const formatLong = isWorker && format === 'iife' ? 'worker-iife' : format
  const toRelativePath = customRelativeUrlMechanisms[formatLong]
  return (filename, importer) => ({
    runtime: toRelativePath(
      path.posix.relative(path.dirname(importer), filename),
    ),
  })
}
export function toOutputFilePathWithoutRuntime(
  filename,
  type,
  hostId,
  hostType,
  config,
  toRelative,
) {
  const { renderBuiltUrl } = config.experimental
  let relative = config.base === '' || config.base === './'
  if (renderBuiltUrl) {
    const result = renderBuiltUrl(filename, {
      hostId,
      hostType,
      type,
      ssr: !!config.build.ssr,
    })
    if (typeof result === 'object') {
      if (result.runtime) {
        throw new Error(
          `{ runtime: "${result.runtime}" } is not supported for assets in ${hostType} files: ${filename}`,
        )
      }
      if (typeof result.relative === 'boolean') {
        relative = result.relative
      }
    } else if (result) {
      return result
    }
  }
  if (relative && !config.build.ssr) {
    return toRelative(filename, hostId)
  } else {
    return joinUrlSegments(config.base, filename)
  }
}
export const toOutputFilePathInCss = toOutputFilePathWithoutRuntime
export const toOutputFilePathInHtml = toOutputFilePathWithoutRuntime
function areSeparateFolders(a, b) {
  const na = normalizePath(a)
  const nb = normalizePath(b)
  return (
    na !== nb &&
    !na.startsWith(withTrailingSlash(nb)) &&
    !nb.startsWith(withTrailingSlash(na))
  )
}
