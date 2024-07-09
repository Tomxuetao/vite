import type { ViteModuleRunner, ViteRuntimeModuleContext } from './types'
export declare class ESModulesRunner implements ViteModuleRunner {
  runViteModule(context: ViteRuntimeModuleContext, code: string): Promise<any>
  runExternalModule(filepath: string): Promise<any>
}
