export function resolveSSROptions(ssr, preserveSymlinks) {
  ssr ??= {}
  const optimizeDeps = ssr.optimizeDeps ?? {}
  const target = 'node'
  return {
    target,
    ...ssr,
    optimizeDeps: {
      ...optimizeDeps,
      noDiscovery: true,
      esbuildOptions: {
        preserveSymlinks,
        ...optimizeDeps.esbuildOptions,
      },
    },
  }
}
