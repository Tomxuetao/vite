import type { TestAPI } from 'vitest'
import type { ViteRuntime } from 'vite/runtime'
import type { MainThreadRuntimeOptions } from '../mainThreadRuntime'
import type { ViteDevServer } from '../../../server'
import type { InlineConfig } from '../../../config'
interface TestClient {
  server: ViteDevServer
  runtime: ViteRuntime
}
export declare function createViteRuntimeTester(
  config?: InlineConfig,
  runtimeConfig?: MainThreadRuntimeOptions,
): Promise<TestAPI<TestClient>>
export declare function createFile(file: string, content: string): void
export declare function editFile(
  file: string,
  callback: (content: string) => string,
): void
export declare function resolvePath(baseUrl: string, path: string): string
export {}
