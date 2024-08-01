import { isModernFlag } from './importAnalysisBuild'
export const modulePreloadPolyfillId = 'vite/modulepreload-polyfill'
const resolvedModulePreloadPolyfillId = '\0' + modulePreloadPolyfillId + '.js'
export function modulePreloadPolyfillPlugin(config) {
  // `isModernFlag` is only available during build since it is resolved by `vite:build-import-analysis`
  const skip = config.command !== 'build' || config.build.ssr
  let polyfillString
  return {
    name: 'vite:modulepreload-polyfill',
    resolveId(id) {
      if (id === modulePreloadPolyfillId) {
        return resolvedModulePreloadPolyfillId
      }
    },
    load(id) {
      if (id === resolvedModulePreloadPolyfillId) {
        if (skip) {
          return ''
        }
        if (!polyfillString) {
          polyfillString = `${isModernFlag}&&(${polyfill.toString()}());`
        }
        return { code: polyfillString, moduleSideEffects: true }
      }
    },
  }
}
function polyfill() {
  const relList = document.createElement('link').relList
  if (relList && relList.supports && relList.supports('modulepreload')) {
    return
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link)
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') {
        continue
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === 'LINK' && node.rel === 'modulepreload')
          processPreload(node)
      }
    }
  }).observe(document, { childList: true, subtree: true })
  function getFetchOpts(link) {
    const fetchOpts = {}
    if (link.integrity) fetchOpts.integrity = link.integrity
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy
    if (link.crossOrigin === 'use-credentials')
      fetchOpts.credentials = 'include'
    else if (link.crossOrigin === 'anonymous') fetchOpts.credentials = 'omit'
    else fetchOpts.credentials = 'same-origin'
    return fetchOpts
  }
  function processPreload(link) {
    if (link.ep)
      // ep marker = processed
      return
    link.ep = true
    // prepopulate the load record
    const fetchOpts = getFetchOpts(link)
    fetch(link.href, fetchOpts)
  }
}
