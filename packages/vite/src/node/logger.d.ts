import type { RollupError } from 'rollup'
import type { ResolvedServerUrls } from './server'
export type LogType = 'error' | 'warn' | 'info'
export type LogLevel = LogType | 'silent'
export interface Logger {
  info(msg: string, options?: LogOptions): void
  warn(msg: string, options?: LogOptions): void
  warnOnce(msg: string, options?: LogOptions): void
  error(msg: string, options?: LogErrorOptions): void
  clearScreen(type: LogType): void
  hasErrorLogged(error: Error | RollupError): boolean
  hasWarned: boolean
}
export interface LogOptions {
  clear?: boolean
  timestamp?: boolean
}
export interface LogErrorOptions extends LogOptions {
  error?: Error | RollupError | null
}
export declare const LogLevels: Record<LogLevel, number>
export interface LoggerOptions {
  prefix?: string
  allowClearScreen?: boolean
  customLogger?: Logger
}
export declare function createLogger(
  level?: LogLevel,
  options?: LoggerOptions,
): Logger
export declare function printServerUrls(
  urls: ResolvedServerUrls,
  optionsHost: string | boolean | undefined,
  info: Logger['info'],
): void
