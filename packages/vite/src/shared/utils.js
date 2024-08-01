import { NULL_BYTE_PLACEHOLDER, VALID_ID_PREFIX } from './constants'
export const isWindows =
  typeof process !== 'undefined' && process.platform === 'win32'
/**
 * Prepend `/@id/` and replace null byte so the id is URL-safe.
 * This is prepended to resolved ids that are not valid browser
 * import specifiers by the importAnalysis plugin.
 */
export function wrapId(id) {
  return id.startsWith(VALID_ID_PREFIX)
    ? id
    : VALID_ID_PREFIX + id.replace('\0', NULL_BYTE_PLACEHOLDER)
}
/**
 * Undo {@link wrapId}'s `/@id/` and null byte replacements.
 */
export function unwrapId(id) {
  return id.startsWith(VALID_ID_PREFIX)
    ? id.slice(VALID_ID_PREFIX.length).replace(NULL_BYTE_PLACEHOLDER, '\0')
    : id
}
const windowsSlashRE = /\\/g
export function slash(p) {
  return p.replace(windowsSlashRE, '/')
}
const postfixRE = /[?#].*$/
export function cleanUrl(url) {
  return url.replace(postfixRE, '')
}
export function isPrimitive(value) {
  return !value || (typeof value !== 'object' && typeof value !== 'function')
}
export function withTrailingSlash(path) {
  if (path[path.length - 1] !== '/') {
    return `${path}/`
  }
  return path
}
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const AsyncFunction = async function () {}.constructor
// https://github.com/nodejs/node/issues/43047#issuecomment-1564068099
export const asyncFunctionDeclarationPaddingLineCount =
  /** #__PURE__ */ (() => {
    const body = '/*code*/'
    const source = new AsyncFunction('a', 'b', body).toString()
    return source.slice(0, source.indexOf(body)).split('\n').length - 1
  })()
