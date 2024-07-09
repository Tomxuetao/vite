import fsp from 'node:fs/promises'
import path from 'node:path'
import MagicString from 'magic-string'
import {
  addToHTMLProxyCache,
  applyHtmlTransforms,
  assetAttrsConfig,
  extractImportExpressionFromClassicScript,
  findNeedTransformStyleAttribute,
  getAttrKey,
  getScriptInfo,
  htmlEnvHook,
  htmlProxyResult,
  injectCspNonceMetaTagHook,
  injectNonceAttributeTagHook,
  nodeIsElement,
  overwriteAttrValue,
  postImportMapHook,
  preImportMapHook,
  resolveHtmlTransforms,
  traverseHtml,
} from '../../plugins/html'
import { send } from '../send'
import { CLIENT_PUBLIC_PATH, FS_PREFIX } from '../../constants'
import {
  ensureWatchedFile,
  fsPathFromId,
  getHash,
  injectQuery,
  isDevServer,
  isJSRequest,
  joinUrlSegments,
  normalizePath,
  processSrcSetSync,
  stripBase,
} from '../../utils'
import { getFsUtils } from '../../fsUtils'
import { checkPublicFile } from '../../publicDir'
import { isCSSRequest } from '../../plugins/css'
import { getCodeWithSourcemap, injectSourcesContent } from '../sourcemap'
import { cleanUrl, unwrapId, wrapId } from '../../../shared/utils'
export function createDevHtmlTransformFn(config) {
  const [preHooks, normalHooks, postHooks] = resolveHtmlTransforms(
    config.plugins,
    config.logger,
  )
  const transformHooks = [
    preImportMapHook(config),
    injectCspNonceMetaTagHook(config),
    ...preHooks,
    htmlEnvHook(config),
    devHtmlHook,
    ...normalHooks,
    ...postHooks,
    injectNonceAttributeTagHook(config),
    postImportMapHook(),
  ]
  return (server, url, html, originalUrl) => {
    return applyHtmlTransforms(html, transformHooks, {
      path: url,
      filename: getHtmlFilename(url, server),
      server,
      originalUrl,
    })
  }
}
function getHtmlFilename(url, server) {
  if (url.startsWith(FS_PREFIX)) {
    return decodeURIComponent(fsPathFromId(url))
  } else {
    return decodeURIComponent(
      normalizePath(path.join(server.config.root, url.slice(1))),
    )
  }
}
function shouldPreTransform(url, config) {
  return (
    !checkPublicFile(url, config) && (isJSRequest(url) || isCSSRequest(url))
  )
}
const wordCharRE = /\w/
function isBareRelative(url) {
  return wordCharRE.test(url[0]) && !url.includes(':')
}
const isSrcSet = (attr) => attr.name === 'srcset' && attr.prefix === undefined
const processNodeUrl = (
  url,
  useSrcSetReplacer,
  config,
  htmlPath,
  originalUrl,
  server,
  isClassicScriptLink,
) => {
  // prefix with base (dev only, base is never relative)
  const replacer = (url) => {
    if (server?.moduleGraph) {
      const mod = server.moduleGraph.urlToModuleMap.get(url)
      if (mod && mod.lastHMRTimestamp > 0) {
        url = injectQuery(url, `t=${mod.lastHMRTimestamp}`)
      }
    }
    if (
      (url[0] === '/' && url[1] !== '/') ||
      // #3230 if some request url (localhost:3000/a/b) return to fallback html, the relative assets
      // path will add `/a/` prefix, it will caused 404.
      //
      // skip if url contains `:` as it implies a url protocol or Windows path that we don't want to replace.
      //
      // rewrite `./index.js` -> `localhost:5173/a/index.js`.
      // rewrite `../index.js` -> `localhost:5173/index.js`.
      // rewrite `relative/index.js` -> `localhost:5173/a/relative/index.js`.
      ((url[0] === '.' || isBareRelative(url)) &&
        originalUrl &&
        originalUrl !== '/' &&
        htmlPath === '/index.html')
    ) {
      url = path.posix.join(config.base, url)
    }
    if (server && !isClassicScriptLink && shouldPreTransform(url, config)) {
      let preTransformUrl
      if (url[0] === '/' && url[1] !== '/') {
        preTransformUrl = url
      } else if (url[0] === '.' || isBareRelative(url)) {
        preTransformUrl = path.posix.join(
          config.base,
          path.posix.dirname(htmlPath),
          url,
        )
      }
      if (preTransformUrl) {
        preTransformRequest(server, preTransformUrl, config.base)
      }
    }
    return url
  }
  const processedUrl = useSrcSetReplacer
    ? processSrcSetSync(url, ({ url }) => replacer(url))
    : replacer(url)
  return processedUrl
}
const devHtmlHook = async (
  html,
  { path: htmlPath, filename, server, originalUrl },
) => {
  const { config, moduleGraph, watcher } = server
  const base = config.base || '/'
  let proxyModulePath
  let proxyModuleUrl
  const trailingSlash = htmlPath.endsWith('/')
  if (!trailingSlash && getFsUtils(config).existsSync(filename)) {
    proxyModulePath = htmlPath
    proxyModuleUrl = proxyModulePath
  } else {
    // There are users of vite.transformIndexHtml calling it with url '/'
    // for SSR integrations #7993, filename is root for this case
    // A user may also use a valid name for a virtual html file
    // Mark the path as virtual in both cases so sourcemaps aren't processed
    // and ids are properly handled
    const validPath = `${htmlPath}${trailingSlash ? 'index.html' : ''}`
    proxyModulePath = `\0${validPath}`
    proxyModuleUrl = wrapId(proxyModulePath)
  }
  proxyModuleUrl = joinUrlSegments(base, proxyModuleUrl)
  const s = new MagicString(html)
  let inlineModuleIndex = -1
  // The key to the proxyHtml cache is decoded, as it will be compared
  // against decoded URLs by the HTML plugins.
  const proxyCacheUrl = decodeURI(
    cleanUrl(proxyModulePath).replace(normalizePath(config.root), ''),
  )
  const styleUrl = []
  const inlineStyles = []
  const addInlineModule = (node, ext) => {
    inlineModuleIndex++
    const contentNode = node.childNodes[0]
    const code = contentNode.value
    let map
    if (proxyModulePath[0] !== '\0') {
      map = new MagicString(html)
        .snip(
          contentNode.sourceCodeLocation.startOffset,
          contentNode.sourceCodeLocation.endOffset,
        )
        .generateMap({ hires: 'boundary' })
      map.sources = [filename]
      map.file = filename
    }
    // add HTML Proxy to Map
    addToHTMLProxyCache(config, proxyCacheUrl, inlineModuleIndex, { code, map })
    // inline js module. convert to src="proxy" (dev only, base is never relative)
    const modulePath = `${proxyModuleUrl}?html-proxy&index=${inlineModuleIndex}.${ext}`
    // invalidate the module so the newly cached contents will be served
    const module = server?.moduleGraph.getModuleById(modulePath)
    if (module) {
      server?.moduleGraph.invalidateModule(module)
    }
    s.update(
      node.sourceCodeLocation.startOffset,
      node.sourceCodeLocation.endOffset,
      `<script type="module" src="${modulePath}"></script>`,
    )
    preTransformRequest(server, modulePath, base)
  }
  await traverseHtml(html, filename, (node) => {
    if (!nodeIsElement(node)) {
      return
    }
    // script tags
    if (node.nodeName === 'script') {
      const { src, sourceCodeLocation, isModule } = getScriptInfo(node)
      if (src) {
        const processedUrl = processNodeUrl(
          src.value,
          isSrcSet(src),
          config,
          htmlPath,
          originalUrl,
          server,
          !isModule,
        )
        if (processedUrl !== src.value) {
          overwriteAttrValue(s, sourceCodeLocation, processedUrl)
        }
      } else if (isModule && node.childNodes.length) {
        addInlineModule(node, 'js')
      } else if (node.childNodes.length) {
        const scriptNode = node.childNodes[node.childNodes.length - 1]
        for (const {
          url,
          start,
          end,
        } of extractImportExpressionFromClassicScript(scriptNode)) {
          const processedUrl = processNodeUrl(
            url,
            false,
            config,
            htmlPath,
            originalUrl,
          )
          if (processedUrl !== url) {
            s.update(start, end, processedUrl)
          }
        }
      }
    }
    const inlineStyle = findNeedTransformStyleAttribute(node)
    if (inlineStyle) {
      inlineModuleIndex++
      inlineStyles.push({
        index: inlineModuleIndex,
        location: inlineStyle.location,
        code: inlineStyle.attr.value,
      })
    }
    if (node.nodeName === 'style' && node.childNodes.length) {
      const children = node.childNodes[0]
      styleUrl.push({
        start: children.sourceCodeLocation.startOffset,
        end: children.sourceCodeLocation.endOffset,
        code: children.value,
      })
    }
    // elements with [href/src] attrs
    const assetAttrs = assetAttrsConfig[node.nodeName]
    if (assetAttrs) {
      for (const p of node.attrs) {
        const attrKey = getAttrKey(p)
        if (p.value && assetAttrs.includes(attrKey)) {
          const processedUrl = processNodeUrl(
            p.value,
            isSrcSet(p),
            config,
            htmlPath,
            originalUrl,
          )
          if (processedUrl !== p.value) {
            overwriteAttrValue(
              s,
              node.sourceCodeLocation.attrs[attrKey],
              processedUrl,
            )
          }
        }
      }
    }
  })
  await Promise.all([
    ...styleUrl.map(async ({ start, end, code }, index) => {
      const url = `${proxyModulePath}?html-proxy&direct&index=${index}.css`
      // ensure module in graph after successful load
      const mod = await moduleGraph.ensureEntryFromUrl(url, false)
      ensureWatchedFile(watcher, mod.file, config.root)
      const result = await server.pluginContainer.transform(code, mod.id)
      let content = ''
      if (result) {
        if (result.map && 'version' in result.map) {
          if (result.map.mappings) {
            await injectSourcesContent(
              result.map,
              proxyModulePath,
              config.logger,
            )
          }
          content = getCodeWithSourcemap('css', result.code, result.map)
        } else {
          content = result.code
        }
      }
      s.overwrite(start, end, content)
    }),
    ...inlineStyles.map(async ({ index, location, code }) => {
      // will transform with css plugin and cache result with css-post plugin
      const url = `${proxyModulePath}?html-proxy&inline-css&style-attr&index=${index}.css`
      const mod = await moduleGraph.ensureEntryFromUrl(url, false)
      ensureWatchedFile(watcher, mod.file, config.root)
      await server?.pluginContainer.transform(code, mod.id)
      const hash = getHash(cleanUrl(mod.id))
      const result = htmlProxyResult.get(`${hash}_${index}`)
      overwriteAttrValue(s, location, result ?? '')
    }),
  ])
  html = s.toString()
  return {
    html,
    tags: [
      {
        tag: 'script',
        attrs: {
          type: 'module',
          src: path.posix.join(base, CLIENT_PUBLIC_PATH),
        },
        injectTo: 'head-prepend',
      },
    ],
  }
}
export function indexHtmlMiddleware(root, server) {
  const isDev = isDevServer(server)
  const fsUtils = getFsUtils(server.config)
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return async function viteIndexHtmlMiddleware(req, res, next) {
    if (res.writableEnded) {
      return next()
    }
    const url = req.url && cleanUrl(req.url)
    // htmlFallbackMiddleware appends '.html' to URLs
    if (url?.endsWith('.html') && req.headers['sec-fetch-dest'] !== 'script') {
      let filePath
      if (isDev && url.startsWith(FS_PREFIX)) {
        filePath = decodeURIComponent(fsPathFromId(url))
      } else {
        filePath = path.join(root, decodeURIComponent(url))
      }
      if (fsUtils.existsSync(filePath)) {
        const headers = isDev
          ? server.config.server.headers
          : server.config.preview.headers
        try {
          let html = await fsp.readFile(filePath, 'utf-8')
          if (isDev) {
            html = await server.transformIndexHtml(url, html, req.originalUrl)
          }
          return send(req, res, html, 'html', { headers })
        } catch (e) {
          return next(e)
        }
      }
    }
    next()
  }
}
function preTransformRequest(server, url, base) {
  if (!server.config.server.preTransformRequests) return
  // transform all url as non-ssr as html includes client-side assets only
  try {
    url = unwrapId(stripBase(decodeURI(url), base))
  } catch {
    // ignore
    return
  }
  server.warmupRequest(url)
}
