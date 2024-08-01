import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
export type WorkerType = 'classic' | 'module' | 'ignore'
export declare const workerOrSharedWorkerRE: RegExp
export declare const WORKER_FILE_ID = 'worker_file'
export declare const workerAssetUrlRE: RegExp
export declare function workerFileToUrl(
  config: ResolvedConfig,
  id: string,
): Promise<string>
export declare function webWorkerPostPlugin(): Plugin
export declare function webWorkerPlugin(config: ResolvedConfig): Plugin
