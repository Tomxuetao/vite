/**
 * Prepares the rendered chunks to contain additional metadata during build.
 */
export function metadataPlugin() {
  return {
    name: 'vite:build-metadata',
    async renderChunk(_code, chunk) {
      chunk.viteMetadata = {
        importedAssets: new Set(),
        importedCss: new Set(),
      }
      return null
    },
  }
}
