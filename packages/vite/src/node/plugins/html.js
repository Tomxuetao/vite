import path from 'node:path'
import MagicString from 'magic-string'
import colors from 'picocolors'
import { stripLiteral } from 'strip-literal'
import {
  encodeURIPath,
  generateCodeFrame,
  getHash,
  isDataUrl,
  isExternalUrl,
  normalizePath,
  partialEncodeURIPath,
  processSrcSet,
  removeLeadingSlash,
  unique,
  urlCanParse,
} from '../utils'
import { checkPublicFile } from '../publicDir'
import { toOutputFilePathInHtml } from '../build'
import { resolveEnvPrefix } from '../env'
import { cleanUrl } from '../../shared/utils'
import {
  assetUrlRE,
  getPublicAssetFilename,
  publicAssetUrlRE,
  urlToBuiltUrl,
} from './asset'
import { isCSSRequest } from './css'
import { modulePreloadPolyfillId } from './modulePreloadPolyfill'
const htmlProxyRE =
  /\?html-proxy=?(?:&inline-css)?(?:&style-attr)?&index=(\d+)\.(js|css)$/
const isHtmlProxyRE = /\?html-proxy\b/
const inlineCSSRE = /__VITE_INLINE_CSS__([a-z\d]{8}_\d+)__/g
// Do not allow preceding '.', but do allow preceding '...' for spread operations
const inlineImportRE =
  /(?<!(?<!\.\.)\.)\bimport\s*\(("(?:[^"]|(?<=\\)")*"|'(?:[^']|(?<=\\)')*')\)/dg
const htmlLangRE = /\.(?:html|htm)$/
const spaceRe = /[\t\n\f\r ]/
const importMapRE =
  /[ \t]*<script[^>]*type\s*=\s*(?:"importmap"|'importmap'|importmap)[^>]*>.*?<\/script>/is
const moduleScriptRE =
  /[ \t]*<script[^>]*type\s*=\s*(?:"module"|'module'|module)[^>]*>/i
const modulePreloadLinkRE =
  /[ \t]*<link[^>]*rel\s*=\s*(?:"modulepreload"|'modulepreload'|modulepreload)[\s\S]*?\/>/i
const importMapAppendRE = new RegExp(
  [moduleScriptRE, modulePreloadLinkRE].map((r) => r.source).join('|'),
  'i',
)
export const isHTMLProxy = (id) => isHtmlProxyRE.test(id)
export const isHTMLRequest = (request) => htmlLangRE.test(request)
// HTML Proxy Caches are stored by config -> filePath -> index
export const htmlProxyMap = new WeakMap()
// HTML Proxy Transform result are stored by config
// `${hash(importer)}_${query.index}` -> transformed css code
// PS: key like `hash(/vite/playground/assets/index.html)_1`)
export const htmlProxyResult = new Map()
export function htmlInlineProxyPlugin(config) {
  // Should do this when `constructor` rather than when `buildStart`,
  // `buildStart` will be triggered multiple times then the cached result will be emptied.
  // https://github.com/vitejs/vite/issues/6372
  htmlProxyMap.set(config, new Map())
  return {
    name: 'vite:html-inline-proxy',
    resolveId(id) {
      if (isHTMLProxy(id)) {
        return id
      }
    },
    load(id) {
      const proxyMatch = id.match(htmlProxyRE)
      if (proxyMatch) {
        const index = Number(proxyMatch[1])
        const file = cleanUrl(id)
        const url = file.replace(normalizePath(config.root), '')
        const result = htmlProxyMap.get(config).get(url)?.[index]
        if (result) {
          return result
        } else {
          throw new Error(`No matching HTML proxy module found from ${id}`)
        }
      }
    },
  }
}
export function addToHTMLProxyCache(config, filePath, index, result) {
  if (!htmlProxyMap.get(config)) {
    htmlProxyMap.set(config, new Map())
  }
  if (!htmlProxyMap.get(config).get(filePath)) {
    htmlProxyMap.get(config).set(filePath, [])
  }
  htmlProxyMap.get(config).get(filePath)[index] = result
}
export function addToHTMLProxyTransformResult(hash, code) {
  htmlProxyResult.set(hash, code)
}
// this extends the config in @vue/compiler-sfc with <link href>
export const assetAttrsConfig = {
  link: ['href'],
  video: ['src', 'poster'],
  source: ['src', 'srcset'],
  img: ['src', 'srcset'],
  image: ['xlink:href', 'href'],
  use: ['xlink:href', 'href'],
}
// Some `<link rel>` elements should not be inlined in build. Excluding:
// - `shortcut`                     : only valid for IE <9, use `icon`
// - `mask-icon`                    : deprecated since Safari 12 (for pinned tabs)
// - `apple-touch-icon-precomposed` : only valid for iOS <7 (for avoiding gloss effect)
const noInlineLinkRels = new Set([
  'icon',
  'apple-touch-icon',
  'apple-touch-startup-image',
  'manifest',
])
export const isAsyncScriptMap = new WeakMap()
export function nodeIsElement(node) {
  return node.nodeName[0] !== '#'
}
function traverseNodes(node, visitor) {
  visitor(node)
  if (
    nodeIsElement(node) ||
    node.nodeName === '#document' ||
    node.nodeName === '#document-fragment'
  ) {
    node.childNodes.forEach((childNode) => traverseNodes(childNode, visitor))
  }
}
export async function traverseHtml(html, filePath, visitor) {
  // lazy load compiler
  const { parse } = await import('parse5')
  const ast = parse(html, {
    scriptingEnabled: false,
    sourceCodeLocationInfo: true,
    onParseError: (e) => {
      handleParseError(e, html, filePath)
    },
  })
  traverseNodes(ast, visitor)
}
export function getScriptInfo(node) {
  let src
  let sourceCodeLocation
  let isModule = false
  let isAsync = false
  for (const p of node.attrs) {
    if (p.prefix !== undefined) continue
    if (p.name === 'src') {
      if (!src) {
        src = p
        sourceCodeLocation = node.sourceCodeLocation?.attrs['src']
      }
    } else if (p.name === 'type' && p.value && p.value === 'module') {
      isModule = true
    } else if (p.name === 'async') {
      isAsync = true
    }
  }
  return { src, sourceCodeLocation, isModule, isAsync }
}
const attrValueStartRE = /=\s*(.)/
export function overwriteAttrValue(s, sourceCodeLocation, newValue) {
  const srcString = s.slice(
    sourceCodeLocation.startOffset,
    sourceCodeLocation.endOffset,
  )
  const valueStart = srcString.match(attrValueStartRE)
  if (!valueStart) {
    // overwrite attr value can only be called for a well-defined value
    throw new Error(
      `[vite:html] internal error, failed to overwrite attribute value`,
    )
  }
  const wrapOffset = valueStart[1] === '"' || valueStart[1] === "'" ? 1 : 0
  const valueOffset = valueStart.index + valueStart[0].length - 1
  s.update(
    sourceCodeLocation.startOffset + valueOffset + wrapOffset,
    sourceCodeLocation.endOffset - wrapOffset,
    newValue,
  )
  return s
}
/**
 * Format parse5 @type {ParserError} to @type {RollupError}
 */
function formatParseError(parserError, id, html) {
  const formattedError = {
    code: parserError.code,
    message: `parse5 error code ${parserError.code}`,
    frame: generateCodeFrame(
      html,
      parserError.startOffset,
      parserError.endOffset,
    ),
    loc: {
      file: id,
      line: parserError.startLine,
      column: parserError.startCol,
    },
  }
  return formattedError
}
function handleParseError(parserError, html, filePath) {
  switch (parserError.code) {
    case 'missing-doctype':
      // ignore missing DOCTYPE
      return
    case 'abandoned-head-element-child':
      // Accept elements without closing tag in <head>
      return
    case 'duplicate-attribute':
      // Accept duplicate attributes #9566
      // The first attribute is used, browsers silently ignore duplicates
      return
    case 'non-void-html-element-start-tag-with-trailing-solidus':
      // Allow self closing on non-void elements #10439
      return
  }
  const parseError = formatParseError(parserError, filePath, html)
  throw new Error(
    `Unable to parse HTML; ${parseError.message}\n` +
      ` at ${parseError.loc.file}:${parseError.loc.line}:${parseError.loc.column}\n` +
      `${parseError.frame}`,
  )
}
/**
 * Compiles index.html into an entry js module
 */
export function buildHtmlPlugin(config) {
  const [preHooks, normalHooks, postHooks] = resolveHtmlTransforms(
    config.plugins,
    config.logger,
  )
  preHooks.unshift(injectCspNonceMetaTagHook(config))
  preHooks.unshift(preImportMapHook(config))
  preHooks.push(htmlEnvHook(config))
  postHooks.push(injectNonceAttributeTagHook(config))
  postHooks.push(postImportMapHook())
  const processedHtml = new Map()
  const isExcludedUrl = (url) =>
    url[0] === '#' || isExternalUrl(url) || isDataUrl(url)
  // Same reason with `htmlInlineProxyPlugin`
  isAsyncScriptMap.set(config, new Map())
  return {
    name: 'vite:build-html',
    async transform(html, id) {
      if (id.endsWith('.html')) {
        id = normalizePath(id)
        const relativeUrlPath = path.posix.relative(config.root, id)
        const publicPath = `/${relativeUrlPath}`
        const publicBase = getBaseInHTML(relativeUrlPath, config)
        const publicToRelative = (filename, importer) => publicBase + filename
        const toOutputPublicFilePath = (url) =>
          toOutputFilePathInHtml(
            url.slice(1),
            'public',
            relativeUrlPath,
            'html',
            config,
            publicToRelative,
          )
        // Determines true start position for the node, either the < character
        // position, or the newline at the end of the previous line's node.
        const nodeStartWithLeadingWhitespace = (node) => {
          const startOffset = node.sourceCodeLocation.startOffset
          if (startOffset === 0) return 0
          // Gets the offset for the start of the line including the
          // newline trailing the previous node
          const lineStartOffset = startOffset - node.sourceCodeLocation.startCol
          // <previous-line-node></previous-line-node>
          // <target-node></target-node>
          //
          // Here we want to target the newline at the end of the previous line
          // as the start position for our target.
          //
          // <previous-node></previous-node>
          // <doubled-up-node></doubled-up-node><target-node></target-node>
          //
          // However, if there is content between our target node start and the
          // previous newline, we cannot strip it out without risking content deletion.
          let isLineEmpty = false
          try {
            const line = s.slice(Math.max(0, lineStartOffset), startOffset)
            isLineEmpty = !line.trim()
          } catch {
            // magic-string may throw if there's some content removed in the sliced string,
            // which we ignore and assume the line is not empty
          }
          return isLineEmpty ? lineStartOffset : startOffset
        }
        // pre-transform
        html = await applyHtmlTransforms(html, preHooks, {
          path: publicPath,
          filename: id,
        })
        let js = ''
        const s = new MagicString(html)
        const scriptUrls = []
        const styleUrls = []
        let inlineModuleIndex = -1
        let everyScriptIsAsync = true
        let someScriptsAreAsync = false
        let someScriptsAreDefer = false
        const assetUrlsPromises = []
        // for each encountered asset url, rewrite original html so that it
        // references the post-build location, ignoring empty attributes and
        // attributes that directly reference named output.
        const namedOutput = Object.keys(
          config?.build?.rollupOptions?.input || {},
        )
        const processAssetUrl = async (url, shouldInline) => {
          if (
            url !== '' && // Empty attribute
            !namedOutput.includes(url) && // Direct reference to named output
            !namedOutput.includes(removeLeadingSlash(url)) // Allow for absolute references as named output can't be an absolute path
          ) {
            try {
              return await urlToBuiltUrl(url, id, config, this, shouldInline)
            } catch (e) {
              if (e.code !== 'ENOENT') {
                throw e
              }
            }
          }
          return url
        }
        await traverseHtml(html, id, (node) => {
          if (!nodeIsElement(node)) {
            return
          }
          let shouldRemove = false
          // script tags
          if (node.nodeName === 'script') {
            const { src, sourceCodeLocation, isModule, isAsync } =
              getScriptInfo(node)
            const url = src && src.value
            const isPublicFile = !!(url && checkPublicFile(url, config))
            if (isPublicFile) {
              // referencing public dir url, prefix with base
              overwriteAttrValue(
                s,
                sourceCodeLocation,
                partialEncodeURIPath(toOutputPublicFilePath(url)),
              )
            }
            if (isModule) {
              inlineModuleIndex++
              if (url && !isExcludedUrl(url) && !isPublicFile) {
                // <script type="module" src="..."/>
                // add it as an import
                js += `\nimport ${JSON.stringify(url)}`
                shouldRemove = true
              } else if (node.childNodes.length) {
                const scriptNode = node.childNodes.pop()
                const contents = scriptNode.value
                // <script type="module">...</script>
                const filePath = id.replace(normalizePath(config.root), '')
                addToHTMLProxyCache(config, filePath, inlineModuleIndex, {
                  code: contents,
                })
                js += `\nimport "${id}?html-proxy&index=${inlineModuleIndex}.js"`
                shouldRemove = true
              }
              everyScriptIsAsync &&= isAsync
              someScriptsAreAsync ||= isAsync
              someScriptsAreDefer ||= !isAsync
            } else if (url && !isPublicFile) {
              if (!isExcludedUrl(url)) {
                config.logger.warn(
                  `<script src="${url}"> in "${publicPath}" can't be bundled without type="module" attribute`,
                )
              }
            } else if (node.childNodes.length) {
              const scriptNode = node.childNodes.pop()
              scriptUrls.push(
                ...extractImportExpressionFromClassicScript(scriptNode),
              )
            }
          }
          // For asset references in index.html, also generate an import
          // statement for each - this will be handled by the asset plugin
          const assetAttrs = assetAttrsConfig[node.nodeName]
          if (assetAttrs) {
            for (const p of node.attrs) {
              const attrKey = getAttrKey(p)
              if (p.value && assetAttrs.includes(attrKey)) {
                if (attrKey === 'srcset') {
                  assetUrlsPromises.push(
                    (async () => {
                      const processedEncodedUrl = await processSrcSet(
                        p.value,
                        async ({ url }) => {
                          const decodedUrl = decodeURI(url)
                          if (!isExcludedUrl(decodedUrl)) {
                            const result = await processAssetUrl(url)
                            return result !== decodedUrl
                              ? encodeURIPath(result)
                              : url
                          }
                          return url
                        },
                      )
                      if (processedEncodedUrl !== p.value) {
                        overwriteAttrValue(
                          s,
                          getAttrSourceCodeLocation(node, attrKey),
                          processedEncodedUrl,
                        )
                      }
                    })(),
                  )
                } else {
                  const url = decodeURI(p.value)
                  if (checkPublicFile(url, config)) {
                    overwriteAttrValue(
                      s,
                      getAttrSourceCodeLocation(node, attrKey),
                      partialEncodeURIPath(toOutputPublicFilePath(url)),
                    )
                  } else if (!isExcludedUrl(url)) {
                    if (
                      node.nodeName === 'link' &&
                      isCSSRequest(url) &&
                      // should not be converted if following attributes are present (#6748)
                      !node.attrs.some(
                        (p) =>
                          p.prefix === undefined &&
                          (p.name === 'media' || p.name === 'disabled'),
                      )
                    ) {
                      // CSS references, convert to import
                      const importExpression = `\nimport ${JSON.stringify(url)}`
                      styleUrls.push({
                        url,
                        start: nodeStartWithLeadingWhitespace(node),
                        end: node.sourceCodeLocation.endOffset,
                      })
                      js += importExpression
                    } else {
                      // If the node is a link, check if it can be inlined. If not, set `shouldInline`
                      // to `false` to force no inline. If `undefined`, it leaves to the default heuristics.
                      const isNoInlineLink =
                        node.nodeName === 'link' &&
                        node.attrs.some(
                          (p) =>
                            p.name === 'rel' &&
                            parseRelAttr(p.value).some((v) =>
                              noInlineLinkRels.has(v),
                            ),
                        )
                      const shouldInline = isNoInlineLink ? false : undefined
                      assetUrlsPromises.push(
                        (async () => {
                          const processedUrl = await processAssetUrl(
                            url,
                            shouldInline,
                          )
                          if (processedUrl !== url) {
                            overwriteAttrValue(
                              s,
                              getAttrSourceCodeLocation(node, attrKey),
                              partialEncodeURIPath(processedUrl),
                            )
                          }
                        })(),
                      )
                    }
                  }
                }
              }
            }
          }
          const inlineStyle = findNeedTransformStyleAttribute(node)
          if (inlineStyle) {
            inlineModuleIndex++
            // replace `inline style` with __VITE_INLINE_CSS__**_**__
            // and import css in js code
            const code = inlineStyle.attr.value
            const filePath = id.replace(normalizePath(config.root), '')
            addToHTMLProxyCache(config, filePath, inlineModuleIndex, { code })
            // will transform with css plugin and cache result with css-post plugin
            js += `\nimport "${id}?html-proxy&inline-css&style-attr&index=${inlineModuleIndex}.css"`
            const hash = getHash(cleanUrl(id))
            // will transform in `applyHtmlTransforms`
            overwriteAttrValue(
              s,
              inlineStyle.location,
              `__VITE_INLINE_CSS__${hash}_${inlineModuleIndex}__`,
            )
          }
          // <style>...</style>
          if (node.nodeName === 'style' && node.childNodes.length) {
            const styleNode = node.childNodes.pop()
            const filePath = id.replace(normalizePath(config.root), '')
            inlineModuleIndex++
            addToHTMLProxyCache(config, filePath, inlineModuleIndex, {
              code: styleNode.value,
            })
            js += `\nimport "${id}?html-proxy&inline-css&index=${inlineModuleIndex}.css"`
            const hash = getHash(cleanUrl(id))
            // will transform in `applyHtmlTransforms`
            s.update(
              styleNode.sourceCodeLocation.startOffset,
              styleNode.sourceCodeLocation.endOffset,
              `__VITE_INLINE_CSS__${hash}_${inlineModuleIndex}__`,
            )
          }
          if (shouldRemove) {
            // remove the script tag from the html. we are going to inject new
            // ones in the end.
            s.remove(
              nodeStartWithLeadingWhitespace(node),
              node.sourceCodeLocation.endOffset,
            )
          }
        })
        isAsyncScriptMap.get(config).set(id, everyScriptIsAsync)
        if (someScriptsAreAsync && someScriptsAreDefer) {
          config.logger.warn(
            `\nMixed async and defer script modules in ${id}, output script will fallback to defer. Every script, including inline ones, need to be marked as async for your output script to be async.`,
          )
        }
        await Promise.all(assetUrlsPromises)
        // emit <script>import("./aaa")</script> asset
        for (const { start, end, url } of scriptUrls) {
          if (checkPublicFile(url, config)) {
            s.update(
              start,
              end,
              partialEncodeURIPath(toOutputPublicFilePath(url)),
            )
          } else if (!isExcludedUrl(url)) {
            s.update(
              start,
              end,
              partialEncodeURIPath(await urlToBuiltUrl(url, id, config, this)),
            )
          }
        }
        // ignore <link rel="stylesheet"> if its url can't be resolved
        const resolvedStyleUrls = await Promise.all(
          styleUrls.map(async (styleUrl) => ({
            ...styleUrl,
            resolved: await this.resolve(styleUrl.url, id),
          })),
        )
        for (const { start, end, url, resolved } of resolvedStyleUrls) {
          if (resolved == null) {
            config.logger.warnOnce(
              `\n${url} doesn't exist at build time, it will remain unchanged to be resolved at runtime`,
            )
            const importExpression = `\nimport ${JSON.stringify(url)}`
            js = js.replace(importExpression, '')
          } else {
            s.remove(start, end)
          }
        }
        processedHtml.set(id, s.toString())
        // inject module preload polyfill only when configured and needed
        const { modulePreload } = config.build
        if (
          modulePreload !== false &&
          modulePreload.polyfill &&
          (someScriptsAreAsync || someScriptsAreDefer)
        ) {
          js = `import "${modulePreloadPolyfillId}";\n${js}`
        }
        // Force rollup to keep this module from being shared between other entry points.
        // If the resulting chunk is empty, it will be removed in generateBundle.
        return { code: js, moduleSideEffects: 'no-treeshake' }
      }
    },
    async generateBundle(options, bundle) {
      const analyzedChunk = new Map()
      const inlineEntryChunk = new Set()
      const getImportedChunks = (chunk, seen = new Set()) => {
        const chunks = []
        chunk.imports.forEach((file) => {
          const importee = bundle[file]
          if (importee?.type === 'chunk' && !seen.has(file)) {
            seen.add(file)
            // post-order traversal
            chunks.push(...getImportedChunks(importee, seen))
            chunks.push(importee)
          }
        })
        return chunks
      }
      const toScriptTag = (chunk, toOutputPath, isAsync) => ({
        tag: 'script',
        attrs: {
          ...(isAsync ? { async: true } : {}),
          type: 'module',
          // crossorigin must be set not only for serving assets in a different origin
          // but also to make it possible to preload the script using `<link rel="preload">`.
          // `<script type="module">` used to fetch the script with credential mode `omit`,
          // however `crossorigin` attribute cannot specify that value.
          // https://developer.chrome.com/blog/modulepreload/#ok-so-why-doesnt-link-relpreload-work-for-modules:~:text=For%20%3Cscript%3E,of%20other%20modules.
          // Now `<script type="module">` uses `same origin`: https://github.com/whatwg/html/pull/3656#:~:text=Module%20scripts%20are%20always%20fetched%20with%20credentials%20mode%20%22same%2Dorigin%22%20by%20default%20and%20can%20no%20longer%0Ause%20%22omit%22
          crossorigin: true,
          src: toOutputPath(chunk.fileName),
        },
      })
      const toPreloadTag = (filename, toOutputPath) => ({
        tag: 'link',
        attrs: {
          rel: 'modulepreload',
          crossorigin: true,
          href: toOutputPath(filename),
        },
      })
      const getCssTagsForChunk = (chunk, toOutputPath, seen = new Set()) => {
        const tags = []
        if (!analyzedChunk.has(chunk)) {
          analyzedChunk.set(chunk, 1)
          chunk.imports.forEach((file) => {
            const importee = bundle[file]
            if (importee?.type === 'chunk') {
              tags.push(...getCssTagsForChunk(importee, toOutputPath, seen))
            }
          })
        }
        chunk.viteMetadata.importedCss.forEach((file) => {
          if (!seen.has(file)) {
            seen.add(file)
            tags.push({
              tag: 'link',
              attrs: {
                rel: 'stylesheet',
                crossorigin: true,
                href: toOutputPath(file),
              },
            })
          }
        })
        return tags
      }
      for (const [normalizedId, html] of processedHtml) {
        const relativeUrlPath = path.posix.relative(config.root, normalizedId)
        const assetsBase = getBaseInHTML(relativeUrlPath, config)
        const toOutputFilePath = (filename, type) => {
          if (isExternalUrl(filename)) {
            return filename
          } else {
            return toOutputFilePathInHtml(
              filename,
              type,
              relativeUrlPath,
              'html',
              config,
              (filename, importer) => assetsBase + filename,
            )
          }
        }
        const toOutputAssetFilePath = (filename) =>
          toOutputFilePath(filename, 'asset')
        const toOutputPublicAssetFilePath = (filename) =>
          toOutputFilePath(filename, 'public')
        const isAsync = isAsyncScriptMap.get(config).get(normalizedId)
        let result = html
        // find corresponding entry chunk
        const chunk = Object.values(bundle).find(
          (chunk) =>
            chunk.type === 'chunk' &&
            chunk.isEntry &&
            chunk.facadeModuleId &&
            normalizePath(chunk.facadeModuleId) === normalizedId,
        )
        let canInlineEntry = false
        // inject chunk asset links
        if (chunk) {
          // an entry chunk can be inlined if
          //  - it's an ES module (e.g. not generated by the legacy plugin)
          //  - it contains no meaningful code other than import statements
          if (options.format === 'es' && isEntirelyImport(chunk.code)) {
            canInlineEntry = true
          }
          // when not inlined, inject <script> for entry and modulepreload its dependencies
          // when inlined, discard entry chunk and inject <script> for everything in post-order
          const imports = getImportedChunks(chunk)
          let assetTags
          if (canInlineEntry) {
            assetTags = imports.map((chunk) =>
              toScriptTag(chunk, toOutputAssetFilePath, isAsync),
            )
          } else {
            assetTags = [toScriptTag(chunk, toOutputAssetFilePath, isAsync)]
            const { modulePreload } = config.build
            if (modulePreload !== false) {
              const resolveDependencies =
                typeof modulePreload === 'object' &&
                modulePreload.resolveDependencies
              const importsFileNames = imports.map((chunk) => chunk.fileName)
              const resolvedDeps = resolveDependencies
                ? resolveDependencies(chunk.fileName, importsFileNames, {
                    hostId: relativeUrlPath,
                    hostType: 'html',
                  })
                : importsFileNames
              assetTags.push(
                ...resolvedDeps.map((i) =>
                  toPreloadTag(i, toOutputAssetFilePath),
                ),
              )
            }
          }
          assetTags.push(...getCssTagsForChunk(chunk, toOutputAssetFilePath))
          result = injectToHead(result, assetTags)
        }
        // inject css link when cssCodeSplit is false
        if (!config.build.cssCodeSplit) {
          const cssChunk = Object.values(bundle).find(
            (chunk) => chunk.type === 'asset' && chunk.name === 'style.css',
          )
          if (cssChunk) {
            result = injectToHead(result, [
              {
                tag: 'link',
                attrs: {
                  rel: 'stylesheet',
                  crossorigin: true,
                  href: toOutputAssetFilePath(cssChunk.fileName),
                },
              },
            ])
          }
        }
        // no use assets plugin because it will emit file
        let match
        let s
        inlineCSSRE.lastIndex = 0
        while ((match = inlineCSSRE.exec(result))) {
          s ||= new MagicString(result)
          const { 0: full, 1: scopedName } = match
          const cssTransformedCode = htmlProxyResult.get(scopedName)
          s.update(match.index, match.index + full.length, cssTransformedCode)
        }
        if (s) {
          result = s.toString()
        }
        result = await applyHtmlTransforms(
          result,
          [...normalHooks, ...postHooks],
          {
            path: '/' + relativeUrlPath,
            filename: normalizedId,
            bundle,
            chunk,
          },
        )
        // resolve asset url references
        result = result.replace(assetUrlRE, (_, fileHash, postfix = '') => {
          const file = this.getFileName(fileHash)
          if (chunk) {
            chunk.viteMetadata.importedAssets.add(cleanUrl(file))
          }
          return encodeURIPath(toOutputAssetFilePath(file)) + postfix
        })
        result = result.replace(publicAssetUrlRE, (_, fileHash) => {
          const publicAssetPath = toOutputPublicAssetFilePath(
            getPublicAssetFilename(fileHash, config),
          )
          return encodeURIPath(
            urlCanParse(publicAssetPath)
              ? publicAssetPath
              : normalizePath(publicAssetPath),
          )
        })
        if (chunk && canInlineEntry) {
          inlineEntryChunk.add(chunk.fileName)
        }
        const shortEmitName = normalizePath(
          path.relative(config.root, normalizedId),
        )
        this.emitFile({
          type: 'asset',
          fileName: shortEmitName,
          source: result,
        })
      }
      for (const fileName of inlineEntryChunk) {
        // all imports from entry have been inlined to html, prevent rollup from outputting it
        delete bundle[fileName]
      }
    },
  }
}
export function parseRelAttr(attr) {
  return attr.split(spaceRe).map((v) => v.toLowerCase())
}
// <tag style="... url(...) or image-set(...) ..."></tag>
// extract inline styles as virtual css
export function findNeedTransformStyleAttribute(node) {
  const attr = node.attrs.find(
    (prop) =>
      prop.prefix === undefined &&
      prop.name === 'style' &&
      // only url(...) or image-set(...) in css need to emit file
      (prop.value.includes('url(') || prop.value.includes('image-set(')),
  )
  if (!attr) return undefined
  const location = node.sourceCodeLocation?.attrs?.['style']
  return { attr, location }
}
export function extractImportExpressionFromClassicScript(scriptTextNode) {
  const startOffset = scriptTextNode.sourceCodeLocation.startOffset
  const cleanCode = stripLiteral(scriptTextNode.value)
  const scriptUrls = []
  let match
  inlineImportRE.lastIndex = 0
  while ((match = inlineImportRE.exec(cleanCode))) {
    const [, [urlStart, urlEnd]] = match.indices
    const start = urlStart + 1
    const end = urlEnd - 1
    scriptUrls.push({
      start: start + startOffset,
      end: end + startOffset,
      url: scriptTextNode.value.slice(start, end),
    })
  }
  return scriptUrls
}
export function preImportMapHook(config) {
  return (html, ctx) => {
    const importMapIndex = html.search(importMapRE)
    if (importMapIndex < 0) return
    const importMapAppendIndex = html.search(importMapAppendRE)
    if (importMapAppendIndex < 0) return
    if (importMapAppendIndex < importMapIndex) {
      const relativeHtml = normalizePath(
        path.relative(config.root, ctx.filename),
      )
      config.logger.warnOnce(
        colors.yellow(
          colors.bold(
            `(!) <script type="importmap"> should come before <script type="module"> and <link rel="modulepreload"> in /${relativeHtml}`,
          ),
        ),
      )
    }
  }
}
/**
 * Move importmap before the first module script and modulepreload link
 */
export function postImportMapHook() {
  return (html) => {
    if (!importMapAppendRE.test(html)) return
    let importMap
    html = html.replace(importMapRE, (match) => {
      importMap = match
      return ''
    })
    if (importMap) {
      html = html.replace(
        importMapAppendRE,
        (match) => `${importMap}\n${match}`,
      )
    }
    return html
  }
}
export function injectCspNonceMetaTagHook(config) {
  return () => {
    if (!config.html?.cspNonce) return
    return [
      {
        tag: 'meta',
        injectTo: 'head',
        // use nonce attribute so that it's hidden
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce#accessing_nonces_and_nonce_hiding
        attrs: { property: 'csp-nonce', nonce: config.html.cspNonce },
      },
    ]
  }
}
/**
 * Support `%ENV_NAME%` syntax in html files
 */
export function htmlEnvHook(config) {
  const pattern = /%(\S+?)%/g
  const envPrefix = resolveEnvPrefix({ envPrefix: config.envPrefix })
  const env = { ...config.env }
  // account for user env defines
  for (const key in config.define) {
    if (key.startsWith(`import.meta.env.`)) {
      const val = config.define[key]
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val)
          env[key.slice(16)] = typeof parsed === 'string' ? parsed : val
        } catch {
          env[key.slice(16)] = val
        }
      } else {
        env[key.slice(16)] = JSON.stringify(val)
      }
    }
  }
  return (html, ctx) => {
    return html.replace(pattern, (text, key) => {
      if (key in env) {
        return env[key]
      } else {
        if (envPrefix.some((prefix) => key.startsWith(prefix))) {
          const relativeHtml = normalizePath(
            path.relative(config.root, ctx.filename),
          )
          config.logger.warn(
            colors.yellow(
              colors.bold(
                `(!) ${text} is not defined in env variables found in /${relativeHtml}. ` +
                  `Is the variable mistyped?`,
              ),
            ),
          )
        }
        return text
      }
    })
  }
}
export function injectNonceAttributeTagHook(config) {
  const processRelType = new Set(['stylesheet', 'modulepreload', 'preload'])
  return async (html, { filename }) => {
    const nonce = config.html?.cspNonce
    if (!nonce) return
    const s = new MagicString(html)
    await traverseHtml(html, filename, (node) => {
      if (!nodeIsElement(node)) {
        return
      }
      const { nodeName, attrs, sourceCodeLocation } = node
      if (
        nodeName === 'script' ||
        nodeName === 'style' ||
        (nodeName === 'link' &&
          attrs.some(
            (attr) =>
              attr.name === 'rel' &&
              parseRelAttr(attr.value).some((a) => processRelType.has(a)),
          ))
      ) {
        // If we already have a nonce attribute, we don't need to add another one
        if (attrs.some(({ name }) => name === 'nonce')) {
          return
        }
        const startTagEndOffset = sourceCodeLocation.startTag.endOffset
        // if the closing of the start tag includes a `/`, the offset should be 2 so the nonce
        // is appended prior to the `/`
        const appendOffset = html[startTagEndOffset - 2] === '/' ? 2 : 1
        s.appendRight(startTagEndOffset - appendOffset, ` nonce="${nonce}"`)
      }
    })
    return s.toString()
  }
}
export function resolveHtmlTransforms(plugins, logger) {
  const preHooks = []
  const normalHooks = []
  const postHooks = []
  for (const plugin of plugins) {
    const hook = plugin.transformIndexHtml
    if (!hook) continue
    if (typeof hook === 'function') {
      normalHooks.push(hook)
    } else {
      if (!('order' in hook) && 'enforce' in hook) {
        logger.warnOnce(
          colors.yellow(
            `plugin '${plugin.name}' uses deprecated 'enforce' option. Use 'order' option instead.`,
          ),
        )
      }
      if (!('handler' in hook) && 'transform' in hook) {
        logger.warnOnce(
          colors.yellow(
            `plugin '${plugin.name}' uses deprecated 'transform' option. Use 'handler' option instead.`,
          ),
        )
      }
      // `enforce` had only two possible values for the `transformIndexHtml` hook
      // `'pre'` and `'post'` (the default). `order` now works with three values
      // to align with other hooks (`'pre'`, normal, and `'post'`). We map
      // both `enforce: 'post'` to `order: undefined` to avoid a breaking change
      const order = hook.order ?? (hook.enforce === 'pre' ? 'pre' : undefined)
      // @ts-expect-error union type
      const handler = hook.handler ?? hook.transform
      if (order === 'pre') {
        preHooks.push(handler)
      } else if (order === 'post') {
        postHooks.push(handler)
      } else {
        normalHooks.push(handler)
      }
    }
  }
  return [preHooks, normalHooks, postHooks]
}
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/head#see_also
const elementsAllowedInHead = new Set([
  'title',
  'base',
  'link',
  'style',
  'meta',
  'script',
  'noscript',
  'template',
])
function headTagInsertCheck(tags, ctx) {
  if (!tags.length) return
  const { logger } = ctx.server?.config || {}
  const disallowedTags = tags.filter(
    (tagDescriptor) => !elementsAllowedInHead.has(tagDescriptor.tag),
  )
  if (disallowedTags.length) {
    const dedupedTags = unique(
      disallowedTags.map((tagDescriptor) => `<${tagDescriptor.tag}>`),
    )
    logger?.warn(
      colors.yellow(
        colors.bold(
          `[${dedupedTags.join(',')}] can not be used inside the <head> Element, please check the 'injectTo' value`,
        ),
      ),
    )
  }
}
export async function applyHtmlTransforms(html, hooks, ctx) {
  for (const hook of hooks) {
    const res = await hook(html, ctx)
    if (!res) {
      continue
    }
    if (typeof res === 'string') {
      html = res
    } else {
      let tags
      if (Array.isArray(res)) {
        tags = res
      } else {
        html = res.html || html
        tags = res.tags
      }
      let headTags
      let headPrependTags
      let bodyTags
      let bodyPrependTags
      for (const tag of tags) {
        switch (tag.injectTo) {
          case 'body':
            ;(bodyTags ??= []).push(tag)
            break
          case 'body-prepend':
            ;(bodyPrependTags ??= []).push(tag)
            break
          case 'head':
            ;(headTags ??= []).push(tag)
            break
          default:
            ;(headPrependTags ??= []).push(tag)
        }
      }
      headTagInsertCheck([...(headTags || []), ...(headPrependTags || [])], ctx)
      if (headPrependTags) html = injectToHead(html, headPrependTags, true)
      if (headTags) html = injectToHead(html, headTags)
      if (bodyPrependTags) html = injectToBody(html, bodyPrependTags, true)
      if (bodyTags) html = injectToBody(html, bodyTags)
    }
  }
  return html
}
const importRE = /\bimport\s*("[^"]*[^\\]"|'[^']*[^\\]');*/g
const commentRE = /\/\*[\s\S]*?\*\/|\/\/.*$/gm
function isEntirelyImport(code) {
  // only consider "side-effect" imports, which match <script type=module> semantics exactly
  // the regexes will remove too little in some exotic cases, but false-negatives are alright
  return !code.replace(importRE, '').replace(commentRE, '').trim().length
}
function getBaseInHTML(urlRelativePath, config) {
  // Prefer explicit URL if defined for linking to assets and public files from HTML,
  // even when base relative is specified
  return config.base === './' || config.base === ''
    ? path.posix.join(
        path.posix.relative(urlRelativePath, '').slice(0, -2),
        './',
      )
    : config.base
}
const headInjectRE = /([ \t]*)<\/head>/i
const headPrependInjectRE = /([ \t]*)<head[^>]*>/i
const htmlInjectRE = /<\/html>/i
const htmlPrependInjectRE = /([ \t]*)<html[^>]*>/i
const bodyInjectRE = /([ \t]*)<\/body>/i
const bodyPrependInjectRE = /([ \t]*)<body[^>]*>/i
const doctypePrependInjectRE = /<!doctype html>/i
function injectToHead(html, tags, prepend = false) {
  if (tags.length === 0) return html
  if (prepend) {
    // inject as the first element of head
    if (headPrependInjectRE.test(html)) {
      return html.replace(
        headPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
  } else {
    // inject before head close
    if (headInjectRE.test(html)) {
      // respect indentation of head tag
      return html.replace(
        headInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // try to inject before the body tag
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${serializeTags(tags, p1)}\n${match}`,
      )
    }
  }
  // if no head tag is present, we prepend the tag for both prepend and append
  return prependInjectFallback(html, tags)
}
function injectToBody(html, tags, prepend = false) {
  if (tags.length === 0) return html
  if (prepend) {
    // inject after body open
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
    // if no there is no body tag, inject after head or fallback to prepend in html
    if (headInjectRE.test(html)) {
      return html.replace(
        headInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, p1)}`,
      )
    }
    return prependInjectFallback(html, tags)
  } else {
    // inject before body close
    if (bodyInjectRE.test(html)) {
      return html.replace(
        bodyInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // if no body tag is present, append to the html tag, or at the end of the file
    if (htmlInjectRE.test(html)) {
      return html.replace(htmlInjectRE, `${serializeTags(tags)}\n$&`)
    }
    return html + `\n` + serializeTags(tags)
  }
}
function prependInjectFallback(html, tags) {
  // prepend to the html tag, append after doctype, or the document start
  if (htmlPrependInjectRE.test(html)) {
    return html.replace(htmlPrependInjectRE, `$&\n${serializeTags(tags)}`)
  }
  if (doctypePrependInjectRE.test(html)) {
    return html.replace(doctypePrependInjectRE, `$&\n${serializeTags(tags)}`)
  }
  return serializeTags(tags) + html
}
const unaryTags = new Set(['link', 'meta', 'base'])
function serializeTag({ tag, attrs, children }, indent = '') {
  if (unaryTags.has(tag)) {
    return `<${tag}${serializeAttrs(attrs)}>`
  } else {
    return `<${tag}${serializeAttrs(attrs)}>${serializeTags(children, incrementIndent(indent))}</${tag}>`
  }
}
function serializeTags(tags, indent = '') {
  if (typeof tags === 'string') {
    return tags
  } else if (tags && tags.length) {
    return tags.map((tag) => `${indent}${serializeTag(tag, indent)}\n`).join('')
  }
  return ''
}
function serializeAttrs(attrs) {
  let res = ''
  for (const key in attrs) {
    if (typeof attrs[key] === 'boolean') {
      res += attrs[key] ? ` ${key}` : ``
    } else {
      res += ` ${key}=${JSON.stringify(attrs[key])}`
    }
  }
  return res
}
function incrementIndent(indent = '') {
  return `${indent}${indent[0] === '\t' ? '\t' : '  '}`
}
export function getAttrKey(attr) {
  return attr.prefix === undefined ? attr.name : `${attr.prefix}:${attr.name}`
}
function getAttrSourceCodeLocation(node, attrKey) {
  return node.sourceCodeLocation.attrs[attrKey]
}
