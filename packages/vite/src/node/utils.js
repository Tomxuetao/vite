import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exec } from 'node:child_process'
import { createHash } from 'node:crypto'
import { URL, fileURLToPath } from 'node:url'
import { builtinModules, createRequire } from 'node:module'
import { promises as dns } from 'node:dns'
import { performance } from 'node:perf_hooks'
import fsp from 'node:fs/promises'
import remapping from '@ampproject/remapping'
import colors from 'picocolors'
import debug from 'debug'
import { createFilter as _createFilter } from '@rollup/pluginutils'
import { cleanUrl, isWindows, slash, withTrailingSlash } from '../shared/utils'
import { VALID_ID_PREFIX } from '../shared/constants'
import {
  CLIENT_ENTRY,
  CLIENT_PUBLIC_PATH,
  ENV_PUBLIC_PATH,
  FS_PREFIX,
  OPTIMIZABLE_ENTRY_RE,
  loopbackHosts,
  wildcardHosts,
} from './constants'
import { findNearestPackageData, resolvePackageData } from './packages'
export const createFilter = _createFilter
const replaceSlashOrColonRE = /[/:]/g
const replaceDotRE = /\./g
const replaceNestedIdRE = /(\s*>\s*)/g
const replaceHashRE = /#/g
export const flattenId = (id) => {
  const flatId = limitFlattenIdLength(
    id
      .replace(replaceSlashOrColonRE, '_')
      .replace(replaceDotRE, '__')
      .replace(replaceNestedIdRE, '___')
      .replace(replaceHashRE, '____'),
  )
  return flatId
}
const FLATTEN_ID_HASH_LENGTH = 8
const FLATTEN_ID_MAX_FILE_LENGTH = 170
const limitFlattenIdLength = (id, limit = FLATTEN_ID_MAX_FILE_LENGTH) => {
  if (id.length <= limit) {
    return id
  }
  return id.slice(0, limit - (FLATTEN_ID_HASH_LENGTH + 1)) + '_' + getHash(id)
}
export const normalizeId = (id) => id.replace(replaceNestedIdRE, ' > ')
// Supported by Node, Deno, Bun
const NODE_BUILTIN_NAMESPACE = 'node:'
// Supported by Deno
const NPM_BUILTIN_NAMESPACE = 'npm:'
// Supported by Bun
const BUN_BUILTIN_NAMESPACE = 'bun:'
// Some runtimes like Bun injects namespaced modules here, which is not a node builtin
const nodeBuiltins = builtinModules.filter((id) => !id.includes(':'))
// TODO: Use `isBuiltin` from `node:module`, but Deno doesn't support it
export function isBuiltin(id) {
  if (process.versions.deno && id.startsWith(NPM_BUILTIN_NAMESPACE)) return true
  if (process.versions.bun && id.startsWith(BUN_BUILTIN_NAMESPACE)) return true
  return isNodeBuiltin(id)
}
export function isNodeBuiltin(id) {
  if (id.startsWith(NODE_BUILTIN_NAMESPACE)) return true
  return nodeBuiltins.includes(id)
}
export function isInNodeModules(id) {
  return id.includes('node_modules')
}
export function moduleListContains(moduleList, id) {
  return moduleList?.some(
    (m) => m === id || id.startsWith(withTrailingSlash(m)),
  )
}
export function isOptimizable(id, optimizeDeps) {
  const { extensions } = optimizeDeps
  return (
    OPTIMIZABLE_ENTRY_RE.test(id) ||
    (extensions?.some((ext) => id.endsWith(ext)) ?? false)
  )
}
export const bareImportRE = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/
export const deepImportRE = /^([^@][^/]*)\/|^(@[^/]+\/[^/]+)\//
// TODO: use import()
const _require = createRequire(import.meta.url)
export function resolveDependencyVersion(
  dep,
  pkgRelativePath = '../../package.json',
) {
  const pkgPath = path.resolve(_require.resolve(dep), pkgRelativePath)
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version
}
export const rollupVersion = resolveDependencyVersion('rollup')
// set in bin/vite.js
const filter = process.env.VITE_DEBUG_FILTER
const DEBUG = process.env.DEBUG
export function createDebugger(namespace, options = {}) {
  const log = debug(namespace)
  const { onlyWhenFocused } = options
  let enabled = log.enabled
  if (enabled && onlyWhenFocused) {
    const ns = typeof onlyWhenFocused === 'string' ? onlyWhenFocused : namespace
    enabled = !!DEBUG?.includes(ns)
  }
  if (enabled) {
    return (...args) => {
      if (!filter || args.some((a) => a?.includes?.(filter))) {
        log(...args)
      }
    }
  }
}
function testCaseInsensitiveFS() {
  if (!CLIENT_ENTRY.endsWith('client.mjs')) {
    throw new Error(
      `cannot test case insensitive FS, CLIENT_ENTRY const doesn't contain client.mjs`,
    )
  }
  if (!fs.existsSync(CLIENT_ENTRY)) {
    throw new Error(
      'cannot test case insensitive FS, CLIENT_ENTRY does not point to an existing file: ' +
        CLIENT_ENTRY,
    )
  }
  return fs.existsSync(CLIENT_ENTRY.replace('client.mjs', 'cLiEnT.mjs'))
}
export const urlCanParse =
  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  URL.canParse ??
  // URL.canParse is supported from Node.js 18.17.0+, 20.0.0+
  ((path, base) => {
    try {
      new URL(path, base)
      return true
    } catch {
      return false
    }
  })
export const isCaseInsensitiveFS = testCaseInsensitiveFS()
const VOLUME_RE = /^[A-Z]:/i
export function normalizePath(id) {
  return path.posix.normalize(isWindows ? slash(id) : id)
}
export function fsPathFromId(id) {
  const fsPath = normalizePath(
    id.startsWith(FS_PREFIX) ? id.slice(FS_PREFIX.length) : id,
  )
  return fsPath[0] === '/' || VOLUME_RE.test(fsPath) ? fsPath : `/${fsPath}`
}
export function fsPathFromUrl(url) {
  return fsPathFromId(cleanUrl(url))
}
/**
 * Check if dir is a parent of file
 *
 * Warning: parameters are not validated, only works with normalized absolute paths
 *
 * @param dir - normalized absolute path
 * @param file - normalized absolute path
 * @returns true if dir is a parent of file
 */
export function isParentDirectory(dir, file) {
  dir = withTrailingSlash(dir)
  return (
    file.startsWith(dir) ||
    (isCaseInsensitiveFS && file.toLowerCase().startsWith(dir.toLowerCase()))
  )
}
/**
 * Check if 2 file name are identical
 *
 * Warning: parameters are not validated, only works with normalized absolute paths
 *
 * @param file1 - normalized absolute path
 * @param file2 - normalized absolute path
 * @returns true if both files url are identical
 */
export function isSameFileUri(file1, file2) {
  return (
    file1 === file2 ||
    (isCaseInsensitiveFS && file1.toLowerCase() === file2.toLowerCase())
  )
}
export const externalRE = /^(https?:)?\/\//
export const isExternalUrl = (url) => externalRE.test(url)
export const dataUrlRE = /^\s*data:/i
export const isDataUrl = (url) => dataUrlRE.test(url)
export const virtualModuleRE = /^virtual-module:.*/
export const virtualModulePrefix = 'virtual-module:'
const knownJsSrcRE =
  /\.(?:[jt]sx?|m[jt]s|vue|marko|svelte|astro|imba|mdx)(?:$|\?)/
export const isJSRequest = (url) => {
  url = cleanUrl(url)
  if (knownJsSrcRE.test(url)) {
    return true
  }
  if (!path.extname(url) && url[url.length - 1] !== '/') {
    return true
  }
  return false
}
const knownTsRE = /\.(?:ts|mts|cts|tsx)(?:$|\?)/
export const isTsRequest = (url) => knownTsRE.test(url)
const importQueryRE = /(\?|&)import=?(?:&|$)/
const directRequestRE = /(\?|&)direct=?(?:&|$)/
const internalPrefixes = [
  FS_PREFIX,
  VALID_ID_PREFIX,
  CLIENT_PUBLIC_PATH,
  ENV_PUBLIC_PATH,
]
const InternalPrefixRE = new RegExp(`^(?:${internalPrefixes.join('|')})`)
const trailingSeparatorRE = /[?&]$/
export const isImportRequest = (url) => importQueryRE.test(url)
export const isInternalRequest = (url) => InternalPrefixRE.test(url)
export function removeImportQuery(url) {
  return url.replace(importQueryRE, '$1').replace(trailingSeparatorRE, '')
}
export function removeDirectQuery(url) {
  return url.replace(directRequestRE, '$1').replace(trailingSeparatorRE, '')
}
export const urlRE = /(\?|&)url(?:&|$)/
export const rawRE = /(\?|&)raw(?:&|$)/
export function removeUrlQuery(url) {
  return url.replace(urlRE, '$1').replace(trailingSeparatorRE, '')
}
export function removeRawQuery(url) {
  return url.replace(rawRE, '$1').replace(trailingSeparatorRE, '')
}
const replacePercentageRE = /%/g
export function injectQuery(url, queryToInject) {
  // encode percents for consistent behavior with pathToFileURL
  // see #2614 for details
  const resolvedUrl = new URL(
    url.replace(replacePercentageRE, '%25'),
    'relative:///',
  )
  const { search, hash } = resolvedUrl
  let pathname = cleanUrl(url)
  pathname = isWindows ? slash(pathname) : pathname
  return `${pathname}?${queryToInject}${search ? `&` + search.slice(1) : ''}${hash ?? ''}`
}
const timestampRE = /\bt=\d{13}&?\b/
export function removeTimestampQuery(url) {
  return url.replace(timestampRE, '').replace(trailingSeparatorRE, '')
}
export async function asyncReplace(input, re, replacer) {
  let match
  let remaining = input
  let rewritten = ''
  while ((match = re.exec(remaining))) {
    rewritten += remaining.slice(0, match.index)
    rewritten += await replacer(match)
    remaining = remaining.slice(match.index + match[0].length)
  }
  rewritten += remaining
  return rewritten
}
export function timeFrom(start, subtract = 0) {
  const time = performance.now() - start - subtract
  const timeString = (time.toFixed(2) + `ms`).padEnd(5, ' ')
  if (time < 10) {
    return colors.green(timeString)
  } else if (time < 50) {
    return colors.yellow(timeString)
  } else {
    return colors.red(timeString)
  }
}
/**
 * pretty url for logging.
 */
export function prettifyUrl(url, root) {
  url = removeTimestampQuery(url)
  const isAbsoluteFile = url.startsWith(root)
  if (isAbsoluteFile || url.startsWith(FS_PREFIX)) {
    const file = path.posix.relative(
      root,
      isAbsoluteFile ? url : fsPathFromId(url),
    )
    return colors.dim(file)
  } else {
    return colors.dim(url)
  }
}
export function isObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}
export function isDefined(value) {
  return value != null
}
export function tryStatSync(file) {
  try {
    // The "throwIfNoEntry" is a performance optimization for cases where the file does not exist
    return fs.statSync(file, { throwIfNoEntry: false })
  } catch {
    // Ignore errors
  }
}
export function lookupFile(dir, fileNames) {
  while (dir) {
    for (const fileName of fileNames) {
      const fullPath = path.join(dir, fileName)
      if (tryStatSync(fullPath)?.isFile()) return fullPath
    }
    const parentDir = path.dirname(dir)
    if (parentDir === dir) return
    dir = parentDir
  }
}
export function isFilePathESM(filePath, packageCache) {
  if (/\.m[jt]s$/.test(filePath)) {
    return true
  } else if (/\.c[jt]s$/.test(filePath)) {
    return false
  } else {
    // check package.json for type: "module"
    try {
      const pkg = findNearestPackageData(path.dirname(filePath), packageCache)
      return pkg?.data.type === 'module'
    } catch {
      return false
    }
  }
}
export const splitRE = /\r?\n/g
const range = 2
export function pad(source, n = 2) {
  const lines = source.split(splitRE)
  return lines.map((l) => ` `.repeat(n) + l).join(`\n`)
}
export function posToNumber(source, pos) {
  if (typeof pos === 'number') return pos
  const lines = source.split(splitRE)
  const { line, column } = pos
  let start = 0
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    start += lines[i].length + 1
  }
  return start + column
}
export function numberToPos(source, offset) {
  if (typeof offset !== 'number') return offset
  if (offset > source.length) {
    throw new Error(
      `offset is longer than source length! offset ${offset} > length ${source.length}`,
    )
  }
  const lines = source.split(splitRE)
  let counted = 0
  let line = 0
  let column = 0
  for (; line < lines.length; line++) {
    const lineLength = lines[line].length + 1
    if (counted + lineLength >= offset) {
      column = offset - counted + 1
      break
    }
    counted += lineLength
  }
  return { line: line + 1, column }
}
export function generateCodeFrame(source, start = 0, end) {
  start = Math.max(posToNumber(source, start), 0)
  end = Math.min(
    end !== undefined ? posToNumber(source, end) : start,
    source.length,
  )
  const lines = source.split(splitRE)
  let count = 0
  const res = []
  for (let i = 0; i < lines.length; i++) {
    count += lines[i].length
    if (count >= start) {
      for (let j = i - range; j <= i + range || end > count; j++) {
        if (j < 0 || j >= lines.length) continue
        const line = j + 1
        res.push(
          `${line}${' '.repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`,
        )
        const lineLength = lines[j].length
        if (j === i) {
          // push underline
          const pad = Math.max(start - (count - lineLength), 0)
          const length = Math.max(
            1,
            end > count ? lineLength - pad : end - start,
          )
          res.push(`   |  ` + ' '.repeat(pad) + '^'.repeat(length))
        } else if (j > i) {
          if (end > count) {
            const length = Math.max(Math.min(end - count, lineLength), 1)
            res.push(`   |  ` + '^'.repeat(length))
          }
          count += lineLength + 1
        }
      }
      break
    }
    count++
  }
  return res.join('\n')
}
export function isFileReadable(filename) {
  if (!tryStatSync(filename)) {
    return false
  }
  try {
    // Check if current process has read permission to the file
    fs.accessSync(filename, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}
const splitFirstDirRE = /(.+?)[\\/](.+)/
/**
 * Delete every file and subdirectory. **The given directory must exist.**
 * Pass an optional `skip` array to preserve files under the root directory.
 */
export function emptyDir(dir, skip) {
  const skipInDir = []
  let nested = null
  if (skip?.length) {
    for (const file of skip) {
      if (path.dirname(file) !== '.') {
        const matched = file.match(splitFirstDirRE)
        if (matched) {
          nested ??= new Map()
          const [, nestedDir, skipPath] = matched
          let nestedSkip = nested.get(nestedDir)
          if (!nestedSkip) {
            nestedSkip = []
            nested.set(nestedDir, nestedSkip)
          }
          if (!nestedSkip.includes(skipPath)) {
            nestedSkip.push(skipPath)
          }
        }
      } else {
        skipInDir.push(file)
      }
    }
  }
  for (const file of fs.readdirSync(dir)) {
    if (skipInDir.includes(file)) {
      continue
    }
    if (nested?.has(file)) {
      emptyDir(path.resolve(dir, file), nested.get(file))
    } else {
      fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
    }
  }
}
export function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    if (srcFile === destDir) {
      continue
    }
    const destFile = path.resolve(destDir, file)
    const stat = fs.statSync(srcFile)
    if (stat.isDirectory()) {
      copyDir(srcFile, destFile)
    } else {
      fs.copyFileSync(srcFile, destFile)
    }
  }
}
export const ERR_SYMLINK_IN_RECURSIVE_READDIR =
  'ERR_SYMLINK_IN_RECURSIVE_READDIR'
export async function recursiveReaddir(dir) {
  if (!fs.existsSync(dir)) {
    return []
  }
  let dirents
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch (e) {
    if (e.code === 'EACCES') {
      // Ignore permission errors
      return []
    }
    throw e
  }
  if (dirents.some((dirent) => dirent.isSymbolicLink())) {
    const err = new Error(
      'Symbolic links are not supported in recursiveReaddir',
    )
    err.code = ERR_SYMLINK_IN_RECURSIVE_READDIR
    throw err
  }
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name)
      return dirent.isDirectory() ? recursiveReaddir(res) : normalizePath(res)
    }),
  )
  return files.flat(1)
}
// `fs.realpathSync.native` resolves differently in Windows network drive,
// causing file read errors. skip for now.
// https://github.com/nodejs/node/issues/37737
export let safeRealpathSync = isWindows
  ? windowsSafeRealPathSync
  : fs.realpathSync.native
// Based on https://github.com/larrybahr/windows-network-drive
// MIT License, Copyright (c) 2017 Larry Bahr
const windowsNetworkMap = new Map()
function windowsMappedRealpathSync(path) {
  const realPath = fs.realpathSync.native(path)
  if (realPath.startsWith('\\\\')) {
    for (const [network, volume] of windowsNetworkMap) {
      if (realPath.startsWith(network)) return realPath.replace(network, volume)
    }
  }
  return realPath
}
const parseNetUseRE = /^(\w+)? +(\w:) +([^ ]+)\s/
let firstSafeRealPathSyncRun = false
function windowsSafeRealPathSync(path) {
  if (!firstSafeRealPathSyncRun) {
    optimizeSafeRealPathSync()
    firstSafeRealPathSyncRun = true
  }
  return fs.realpathSync(path)
}
function optimizeSafeRealPathSync() {
  // Skip if using Node <18.10 due to MAX_PATH issue: https://github.com/vitejs/vite/issues/12931
  const nodeVersion = process.versions.node.split('.').map(Number)
  if (nodeVersion[0] < 18 || (nodeVersion[0] === 18 && nodeVersion[1] < 10)) {
    safeRealpathSync = fs.realpathSync
    return
  }
  // Check the availability `fs.realpathSync.native`
  // in Windows virtual and RAM disks that bypass the Volume Mount Manager, in programs such as imDisk
  // get the error EISDIR: illegal operation on a directory
  try {
    fs.realpathSync.native(path.resolve('./'))
  } catch (error) {
    if (error.message.includes('EISDIR: illegal operation on a directory')) {
      safeRealpathSync = fs.realpathSync
      return
    }
  }
  exec('net use', (error, stdout) => {
    if (error) return
    const lines = stdout.split('\n')
    // OK           Y:        \\NETWORKA\Foo         Microsoft Windows Network
    // OK           Z:        \\NETWORKA\Bar         Microsoft Windows Network
    for (const line of lines) {
      const m = line.match(parseNetUseRE)
      if (m) windowsNetworkMap.set(m[3], m[2])
    }
    if (windowsNetworkMap.size === 0) {
      safeRealpathSync = fs.realpathSync.native
    } else {
      safeRealpathSync = windowsMappedRealpathSync
    }
  })
}
export function ensureWatchedFile(watcher, file, root) {
  if (
    file &&
    // only need to watch if out of root
    !file.startsWith(withTrailingSlash(root)) &&
    // some rollup plugins use null bytes for private resolved Ids
    !file.includes('\0') &&
    fs.existsSync(file)
  ) {
    // resolve file to normalized system path
    watcher.add(path.resolve(file))
  }
}
const escapedSpaceCharacters = /( |\\t|\\n|\\f|\\r)+/g
const imageSetUrlRE = /^(?:[\w\-]+\(.*?\)|'.*?'|".*?"|\S*)/
function joinSrcset(ret) {
  return ret
    .map(({ url, descriptor }) => url + (descriptor ? ` ${descriptor}` : ''))
    .join(', ')
}
// NOTE: The returned `url` should perhaps be decoded so all handled URLs within Vite are consistently decoded.
// However, this may also require a refactor for `cssReplacer` to accept decoded URLs instead.
function splitSrcSetDescriptor(srcs) {
  return splitSrcSet(srcs)
    .map((s) => {
      const src = s.replace(escapedSpaceCharacters, ' ').trim()
      const url = imageSetUrlRE.exec(src)?.[0] ?? ''
      return {
        url,
        descriptor: src.slice(url.length).trim(),
      }
    })
    .filter(({ url }) => !!url)
}
export function processSrcSet(srcs, replacer) {
  return Promise.all(
    splitSrcSetDescriptor(srcs).map(async ({ url, descriptor }) => ({
      url: await replacer({ url, descriptor }),
      descriptor,
    })),
  ).then(joinSrcset)
}
export function processSrcSetSync(srcs, replacer) {
  return joinSrcset(
    splitSrcSetDescriptor(srcs).map(({ url, descriptor }) => ({
      url: replacer({ url, descriptor }),
      descriptor,
    })),
  )
}
const cleanSrcSetRE =
  /(?:url|image|gradient|cross-fade)\([^)]*\)|"([^"]|(?<=\\)")*"|'([^']|(?<=\\)')*'|data:\w+\/[\w.+\-]+;base64,[\w+/=]+|\?\S+,/g
function splitSrcSet(srcs) {
  const parts = []
  /**
   * There could be a ',' inside of:
   * - url(data:...)
   * - linear-gradient(...)
   * - "data:..."
   * - data:...
   * - query parameter ?...
   */
  const cleanedSrcs = srcs.replace(cleanSrcSetRE, blankReplacer)
  let startIndex = 0
  let splitIndex
  do {
    splitIndex = cleanedSrcs.indexOf(',', startIndex)
    parts.push(
      srcs.slice(startIndex, splitIndex !== -1 ? splitIndex : undefined),
    )
    startIndex = splitIndex + 1
  } while (splitIndex !== -1)
  return parts
}
const windowsDriveRE = /^[A-Z]:/
const replaceWindowsDriveRE = /^([A-Z]):\//
const linuxAbsolutePathRE = /^\/[^/]/
function escapeToLinuxLikePath(path) {
  if (windowsDriveRE.test(path)) {
    return path.replace(replaceWindowsDriveRE, '/windows/$1/')
  }
  if (linuxAbsolutePathRE.test(path)) {
    return `/linux${path}`
  }
  return path
}
const revertWindowsDriveRE = /^\/windows\/([A-Z])\//
function unescapeToLinuxLikePath(path) {
  if (path.startsWith('/linux/')) {
    return path.slice('/linux'.length)
  }
  if (path.startsWith('/windows/')) {
    return path.replace(revertWindowsDriveRE, '$1:/')
  }
  return path
}
// based on https://github.com/sveltejs/svelte/blob/abf11bb02b2afbd3e4cac509a0f70e318c306364/src/compiler/utils/mapped_code.ts#L221
const nullSourceMap = {
  names: [],
  sources: [],
  mappings: '',
  version: 3,
}
export function combineSourcemaps(filename, sourcemapList) {
  if (
    sourcemapList.length === 0 ||
    sourcemapList.every((m) => m.sources.length === 0)
  ) {
    return { ...nullSourceMap }
  }
  // hack for parse broken with normalized absolute paths on windows (C:/path/to/something).
  // escape them to linux like paths
  // also avoid mutation here to prevent breaking plugin's using cache to generate sourcemaps like vue (see #7442)
  sourcemapList = sourcemapList.map((sourcemap) => {
    const newSourcemaps = { ...sourcemap }
    newSourcemaps.sources = sourcemap.sources.map((source) =>
      source ? escapeToLinuxLikePath(source) : null,
    )
    if (sourcemap.sourceRoot) {
      newSourcemaps.sourceRoot = escapeToLinuxLikePath(sourcemap.sourceRoot)
    }
    return newSourcemaps
  })
  // We don't declare type here so we can convert/fake/map as RawSourceMap
  let map //: SourceMap
  let mapIndex = 1
  const useArrayInterface =
    sourcemapList.slice(0, -1).find((m) => m.sources.length !== 1) === undefined
  if (useArrayInterface) {
    map = remapping(sourcemapList, () => null)
  } else {
    map = remapping(sourcemapList[0], function loader(sourcefile) {
      const mapForSources = sourcemapList
        .slice(mapIndex)
        .find((s) => s.sources.includes(sourcefile))
      if (mapForSources) {
        mapIndex++
        return mapForSources
      }
      return null
    })
  }
  if (!map.file) {
    delete map.file
  }
  // unescape the previous hack
  map.sources = map.sources.map((source) =>
    source ? unescapeToLinuxLikePath(source) : source,
  )
  map.file = filename
  return map
}
export function unique(arr) {
  return Array.from(new Set(arr))
}
/**
 * Returns resolved localhost address when `dns.lookup` result differs from DNS
 *
 * `dns.lookup` result is same when defaultResultOrder is `verbatim`.
 * Even if defaultResultOrder is `ipv4first`, `dns.lookup` result maybe same.
 * For example, when IPv6 is not supported on that machine/network.
 */
export async function getLocalhostAddressIfDiffersFromDNS() {
  const [nodeResult, dnsResult] = await Promise.all([
    dns.lookup('localhost'),
    dns.lookup('localhost', { verbatim: true }),
  ])
  const isSame =
    nodeResult.family === dnsResult.family &&
    nodeResult.address === dnsResult.address
  return isSame ? undefined : nodeResult.address
}
export function diffDnsOrderChange(oldUrls, newUrls) {
  return !(
    oldUrls === newUrls ||
    (oldUrls &&
      newUrls &&
      arrayEqual(oldUrls.local, newUrls.local) &&
      arrayEqual(oldUrls.network, newUrls.network))
  )
}
export async function resolveHostname(optionsHost) {
  let host
  if (optionsHost === undefined || optionsHost === false) {
    // Use a secure default
    host = 'localhost'
  } else if (optionsHost === true) {
    // If passed --host in the CLI without arguments
    host = undefined // undefined typically means 0.0.0.0 or :: (listen on all IPs)
  } else {
    host = optionsHost
  }
  // Set host name to localhost when possible
  let name = host === undefined || wildcardHosts.has(host) ? 'localhost' : host
  if (host === 'localhost') {
    // See #8647 for more details.
    const localhostAddr = await getLocalhostAddressIfDiffersFromDNS()
    if (localhostAddr) {
      name = localhostAddr
    }
  }
  return { host, name }
}
export async function resolveServerUrls(server, options, config) {
  const address = server.address()
  const isAddressInfo = (x) => x?.address
  if (!isAddressInfo(address)) {
    return { local: [], network: [] }
  }
  const local = []
  const network = []
  const hostname = await resolveHostname(options.host)
  const protocol = options.https ? 'https' : 'http'
  const port = address.port
  const base =
    config.rawBase === './' || config.rawBase === '' ? '/' : config.rawBase
  if (hostname.host !== undefined && !wildcardHosts.has(hostname.host)) {
    let hostnameName = hostname.name
    // ipv6 host
    if (hostnameName.includes(':')) {
      hostnameName = `[${hostnameName}]`
    }
    const address = `${protocol}://${hostnameName}:${port}${base}`
    if (loopbackHosts.has(hostname.host)) {
      local.push(address)
    } else {
      network.push(address)
    }
  } else {
    Object.values(os.networkInterfaces())
      .flatMap((nInterface) => nInterface ?? [])
      .filter(
        (detail) =>
          detail &&
          detail.address &&
          (detail.family === 'IPv4' ||
            // @ts-expect-error Node 18.0 - 18.3 returns number
            detail.family === 4),
      )
      .forEach((detail) => {
        let host = detail.address.replace('127.0.0.1', hostname.name)
        // ipv6 host
        if (host.includes(':')) {
          host = `[${host}]`
        }
        const url = `${protocol}://${host}:${port}${base}`
        if (detail.address.includes('127.0.0.1')) {
          local.push(url)
        } else {
          network.push(url)
        }
      })
  }
  return { local, network }
}
export function arraify(target) {
  return Array.isArray(target) ? target : [target]
}
// Taken from https://stackoverflow.com/a/36328890
export const multilineCommentsRE = /\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g
export const singlelineCommentsRE = /\/\/.*/g
export const requestQuerySplitRE = /\?(?!.*[/|}])/
export const requestQueryMaybeEscapedSplitRE = /\\?\?(?!.*[/|}])/
export const blankReplacer = (match) => ' '.repeat(match.length)
export function getHash(text, length = 8) {
  const h = createHash('sha256').update(text).digest('hex').substring(0, length)
  if (length <= 64) return h
  return h.padEnd(length, '_')
}
const _dirname = path.dirname(fileURLToPath(import.meta.url))
export const requireResolveFromRootWithFallback = (root, id) => {
  // check existence first, so if the package is not found,
  // it won't be cached by nodejs, since there isn't a way to invalidate them:
  // https://github.com/nodejs/node/issues/44663
  const found = resolvePackageData(id, root) || resolvePackageData(id, _dirname)
  if (!found) {
    const error = new Error(`${JSON.stringify(id)} not found.`)
    error.code = 'MODULE_NOT_FOUND'
    throw error
  }
  // actually resolve
  // Search in the root directory first, and fallback to the default require paths.
  return _require.resolve(id, { paths: [root, _dirname] })
}
export function emptyCssComments(raw) {
  return raw.replace(multilineCommentsRE, blankReplacer)
}
function backwardCompatibleWorkerPlugins(plugins) {
  if (Array.isArray(plugins)) {
    return plugins
  }
  if (typeof plugins === 'function') {
    return plugins()
  }
  return []
}
function mergeConfigRecursively(defaults, overrides, rootPath) {
  const merged = { ...defaults }
  for (const key in overrides) {
    const value = overrides[key]
    if (value == null) {
      continue
    }
    const existing = merged[key]
    if (existing == null) {
      merged[key] = value
      continue
    }
    // fields that require special handling
    if (key === 'alias' && (rootPath === 'resolve' || rootPath === '')) {
      merged[key] = mergeAlias(existing, value)
      continue
    } else if (key === 'assetsInclude' && rootPath === '') {
      merged[key] = [].concat(existing, value)
      continue
    } else if (
      key === 'noExternal' &&
      rootPath === 'ssr' &&
      (existing === true || value === true)
    ) {
      merged[key] = true
      continue
    } else if (key === 'plugins' && rootPath === 'worker') {
      merged[key] = () => [
        ...backwardCompatibleWorkerPlugins(existing),
        ...backwardCompatibleWorkerPlugins(value),
      ]
      continue
    }
    if (Array.isArray(existing) || Array.isArray(value)) {
      merged[key] = [...arraify(existing), ...arraify(value)]
      continue
    }
    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeConfigRecursively(
        existing,
        value,
        rootPath ? `${rootPath}.${key}` : key,
      )
      continue
    }
    merged[key] = value
  }
  return merged
}
export function mergeConfig(defaults, overrides, isRoot = true) {
  if (typeof defaults === 'function' || typeof overrides === 'function') {
    throw new Error(`Cannot merge config in form of callback`)
  }
  return mergeConfigRecursively(defaults, overrides, isRoot ? '' : '.')
}
export function mergeAlias(a, b) {
  if (!a) return b
  if (!b) return a
  if (isObject(a) && isObject(b)) {
    return { ...a, ...b }
  }
  // the order is flipped because the alias is resolved from top-down,
  // where the later should have higher priority
  return [...normalizeAlias(b), ...normalizeAlias(a)]
}
export function normalizeAlias(o = []) {
  return Array.isArray(o)
    ? o.map(normalizeSingleAlias)
    : Object.keys(o).map((find) =>
        normalizeSingleAlias({
          find,
          replacement: o[find],
        }),
      )
}
// https://github.com/vitejs/vite/issues/1363
// work around https://github.com/rollup/plugins/issues/759
function normalizeSingleAlias({ find, replacement, customResolver }) {
  if (
    typeof find === 'string' &&
    find[find.length - 1] === '/' &&
    replacement[replacement.length - 1] === '/'
  ) {
    find = find.slice(0, find.length - 1)
    replacement = replacement.slice(0, replacement.length - 1)
  }
  const alias = {
    find,
    replacement,
  }
  if (customResolver) {
    alias.customResolver = customResolver
  }
  return alias
}
/**
 * Transforms transpiled code result where line numbers aren't altered,
 * so we can skip sourcemap generation during dev
 */
export function transformStableResult(s, id, config) {
  return {
    code: s.toString(),
    map:
      config.command === 'build' && config.build.sourcemap
        ? s.generateMap({ hires: 'boundary', source: id })
        : null,
  }
}
export async function asyncFlatten(arr) {
  do {
    arr = (await Promise.all(arr)).flat(Infinity)
  } while (arr.some((v) => v?.then))
  return arr
}
// strip UTF-8 BOM
export function stripBomTag(content) {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1)
  }
  return content
}
const windowsDrivePathPrefixRE = /^[A-Za-z]:[/\\]/
/**
 * path.isAbsolute also returns true for drive relative paths on windows (e.g. /something)
 * this function returns false for them but true for absolute paths (e.g. C:/something)
 */
export const isNonDriveRelativeAbsolutePath = (p) => {
  if (!isWindows) return p[0] === '/'
  return windowsDrivePathPrefixRE.test(p)
}
/**
 * Determine if a file is being requested with the correct case, to ensure
 * consistent behavior between dev and prod and across operating systems.
 */
export function shouldServeFile(filePath, root) {
  // can skip case check on Linux
  if (!isCaseInsensitiveFS) return true
  return hasCorrectCase(filePath, root)
}
/**
 * Note that we can't use realpath here, because we don't want to follow
 * symlinks.
 */
function hasCorrectCase(file, assets) {
  if (file === assets) return true
  const parent = path.dirname(file)
  if (fs.readdirSync(parent).includes(path.basename(file))) {
    return hasCorrectCase(parent, assets)
  }
  return false
}
export function joinUrlSegments(a, b) {
  if (!a || !b) {
    return a || b || ''
  }
  if (a[a.length - 1] === '/') {
    a = a.substring(0, a.length - 1)
  }
  if (b[0] !== '/') {
    b = '/' + b
  }
  return a + b
}
export function removeLeadingSlash(str) {
  return str[0] === '/' ? str.slice(1) : str
}
export function stripBase(path, base) {
  if (path === base) {
    return '/'
  }
  const devBase = withTrailingSlash(base)
  return path.startsWith(devBase) ? path.slice(devBase.length - 1) : path
}
export function arrayEqual(a, b) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
export function evalValue(rawValue) {
  const fn = new Function(`
    var console, exports, global, module, process, require
    return (\n${rawValue}\n)
  `)
  return fn()
}
export function getNpmPackageName(importPath) {
  const parts = importPath.split('/')
  if (parts[0][0] === '@') {
    if (!parts[1]) return null
    return `${parts[0]}/${parts[1]}`
  } else {
    return parts[0]
  }
}
const escapeRegexRE = /[-/\\^$*+?.()|[\]{}]/g
export function escapeRegex(str) {
  return str.replace(escapeRegexRE, '\\$&')
}
export function getPackageManagerCommand(type = 'install') {
  const packageManager =
    process.env.npm_config_user_agent?.split(' ')[0].split('/')[0] || 'npm'
  switch (type) {
    case 'install':
      return packageManager === 'npm' ? 'npm install' : `${packageManager} add`
    case 'uninstall':
      return packageManager === 'npm'
        ? 'npm uninstall'
        : `${packageManager} remove`
    case 'update':
      return packageManager === 'yarn'
        ? 'yarn upgrade'
        : `${packageManager} update`
    default:
      throw new TypeError(`Unknown command type: ${type}`)
  }
}
export function isDevServer(server) {
  return 'pluginContainer' in server
}
export function promiseWithResolvers() {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}
export function createSerialPromiseQueue() {
  let previousTask
  return {
    async run(f) {
      const thisTask = f()
      // wait for both the previous task and this task
      // so that this function resolves in the order this function is called
      const depTasks = Promise.all([previousTask, thisTask])
      previousTask = depTasks
      const [, result] = await depTasks
      // this task was the last one, clear `previousTask` to free up memory
      if (previousTask === depTasks) {
        previousTask = undefined
      }
      return result
    },
  }
}
export function sortObjectKeys(obj) {
  const sorted = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key]
  }
  return sorted
}
export function displayTime(time) {
  // display: {X}ms
  if (time < 1000) {
    return `${time}ms`
  }
  time = time / 1000
  // display: {X}s
  if (time < 60) {
    return `${time.toFixed(2)}s`
  }
  const mins = parseInt((time / 60).toString())
  const seconds = time % 60
  // display: {X}m {Y}s
  return `${mins}m${seconds < 1 ? '' : ` ${seconds.toFixed(0)}s`}`
}
/**
 * Encodes the URI path portion (ignores part after ? or #)
 */
export function encodeURIPath(uri) {
  if (uri.startsWith('data:')) return uri
  const filePath = cleanUrl(uri)
  const postfix = filePath !== uri ? uri.slice(filePath.length) : ''
  return encodeURI(filePath) + postfix
}
/**
 * Like `encodeURIPath`, but only replacing `%` as `%25`. This is useful for environments
 * that can handle un-encoded URIs, where `%` is the only ambiguous character.
 */
export function partialEncodeURIPath(uri) {
  if (uri.startsWith('data:')) return uri
  const filePath = cleanUrl(uri)
  const postfix = filePath !== uri ? uri.slice(filePath.length) : ''
  return filePath.replaceAll('%', '%25') + postfix
}
export const setupSIGTERMListener = (callback) => {
  process.once('SIGTERM', callback)
  if (process.env.CI !== 'true') {
    process.stdin.on('end', callback)
  }
}
export const teardownSIGTERMListener = (callback) => {
  process.off('SIGTERM', callback)
  if (process.env.CI !== 'true') {
    process.stdin.off('end', callback)
  }
}
